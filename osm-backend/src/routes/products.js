const express        = require('express');
const multer         = require('multer');
const XLSX           = require('xlsx');
const Product        = require('../models/Product');
const ImportHistory  = require('../models/ImportHistory');
const { auth, requireRole } = require('../middleware/auth');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const HO_ADMIN = ['Head Office Team', 'System Administrator'];

// ─── Required columns in uploaded Excel ─────────────────────────────────────
const REQUIRED_COLS = ['CATEGORY', 'BRAND', 'ORION_CODE', 'ORION_DESCRIPTION', 'SUB_CATEGORY'];

// ─── Helper: normalise a raw Excel row → product object ─────────────────────
function rowToProduct(row) {
  return {
    category:         String(row['CATEGORY']         || '').trim().toUpperCase(),
    brand:            String(row['BRAND']             || '').trim().toUpperCase(),
    orionCode:        String(row['ORION_CODE']        || '').trim(),
    orionDescription: String(row['ORION_DESCRIPTION'] || '').trim(),
    subCategory:      String(row['SUB_CATEGORY']      || '').trim(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  GET /api/products  — all authenticated users (search / filter support)
// ════════════════════════════════════════════════════════════════════════════
router.get('/', auth, async (req, res) => {
  try {
    const { search, brand, category, orionCode, subCategory, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (brand)       filter.brand    = { $regex: brand, $options: 'i' };
    if (category)    filter.category = { $regex: category, $options: 'i' };
    if (orionCode)   filter.orionCode = { $regex: orionCode, $options: 'i' };
    if (subCategory) filter.subCategory = { $regex: subCategory, $options: 'i' };
    if (search) {
      filter.$or = [
        { brand:            { $regex: search, $options: 'i' } },
        { category:         { $regex: search, $options: 'i' } },
        { orionDescription: { $regex: search, $options: 'i' } },
        { orionCode:        { $regex: search, $options: 'i' } },
        { subCategory:      { $regex: search, $options: 'i' } },
      ];
    }
    const skip  = (Number(page) - 1) * Number(limit);
    const [products, total] = await Promise.all([
      Product.find(filter).sort({ brand: 1, category: 1, orionDescription: 1 }).skip(skip).limit(Number(limit)),
      Product.countDocuments(filter),
    ]);
    res.json({ products, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  GET /api/products/meta  — unique brands, categories, sub-categories
// ════════════════════════════════════════════════════════════════════════════
router.get('/meta', auth, async (req, res) => {
  try {
    const [brands, categories, subCategories, lastImport] = await Promise.all([
      Product.distinct('brand'),
      Product.distinct('category'),
      Product.distinct('subCategory'),
      ImportHistory.findOne().sort({ createdAt: -1 }).lean(),
    ]);
    const total = await Product.countDocuments();
    res.json({ brands: brands.sort(), categories: categories.sort(), subCategories: subCategories.sort(), total, lastImport });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  GET /api/products/template  — download blank Excel template
// ════════════════════════════════════════════════════════════════════════════
router.get('/template', auth, requireRole(...HO_ADMIN), (req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([REQUIRED_COLS]);
  // widen columns for readability
  ws['!cols'] = REQUIRED_COLS.map(() => ({ wch: 24 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Product Master');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=ProductMaster_Template.xlsx');
  res.send(buf);
});

// ════════════════════════════════════════════════════════════════════════════
//  POST /api/products/import/preview
//  Accepts Excel file; returns validation summary WITHOUT writing to DB.
// ════════════════════════════════════════════════════════════════════════════
router.post('/import/preview', auth, requireRole(...HO_ADMIN), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!rows.length) return res.status(400).json({ error: 'The Excel file is empty.' });

    // Validate columns
    const firstRow = rows[0];
    const missing  = REQUIRED_COLS.filter(c => !(c in firstRow));
    if (missing.length) {
      return res.status(400).json({ error: `Missing required columns: ${missing.join(', ')}` });
    }

    // Parse & validate each row
    const valid    = [];
    const invalid  = [];
    const dupMap   = new Map();   // orionDescription → first row index
    const dupRows  = [];

    rows.forEach((raw, idx) => {
      const p = rowToProduct(raw);
      const errs = [];
      if (!p.brand)            errs.push('BRAND is empty');
      if (!p.category)         errs.push('CATEGORY is empty');
      if (!p.orionDescription) errs.push('ORION_DESCRIPTION is empty');
      if (errs.length) { invalid.push({ row: idx + 2, errors: errs, data: p }); return; }

      const key = p.orionDescription.toLowerCase();
      if (dupMap.has(key)) {
        dupRows.push({ row: idx + 2, orionDescription: p.orionDescription, firstRow: dupMap.get(key) + 2 });
      } else {
        dupMap.set(key, idx);
        valid.push(p);
      }
    });

    // Cross-check with existing DB to flag updates vs new
    const existingDescs = new Set(
      (await Product.find({}, 'orionDescription').lean()).map(p => p.orionDescription.toLowerCase())
    );
    const newProducts     = valid.filter(p => !existingDescs.has(p.orionDescription.toLowerCase()));
    const updatedProducts = valid.filter(p =>  existingDescs.has(p.orionDescription.toLowerCase()));

    res.json({
      fileName:        req.file.originalname,
      totalRows:       rows.length,
      validProducts:   valid.length,
      newProducts:     newProducts.length,
      updatedProducts: updatedProducts.length,
      duplicateRows:   dupRows.length,
      invalidRows:     invalid.length,
      preview:         valid.slice(0, 20),   // first 20 for UI preview table
      invalidDetails:  invalid.slice(0, 20),
      duplicateDetails:dupRows.slice(0, 20),
      // pass parsed rows back so /confirm can use them without re-parsing
      _parsedRows:     valid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  POST /api/products/import/confirm
//  Upserts products — new ones are inserted, existing ones are updated,
//  products NOT in the sheet are left completely untouched.
//  Body: { parsedRows: [...], fileName, totalRows, newProducts, updatedProducts, failedRecords }
// ════════════════════════════════════════════════════════════════════════════
router.post('/import/confirm', auth, requireRole(...HO_ADMIN), async (req, res) => {
  try {
    const { parsedRows, fileName, totalRows, newProducts, updatedProducts, failedRecords } = req.body;
    if (!Array.isArray(parsedRows) || !parsedRows.length) {
      return res.status(400).json({ error: 'No product data to import.' });
    }

    // ── Upsert: match on orionDescription, update fields, insert if missing ──
    // Products NOT in this sheet are untouched — they stay in the DB as-is.
    const ops = parsedRows.map(p => ({
      updateOne: {
        filter: { orionDescription: p.orionDescription },
        update: {
          $set: {
            brand:            p.brand,
            category:         p.category,
            orionCode:        p.orionCode,
            orionDescription: p.orionDescription,
            subCategory:      p.subCategory,
            addedBy:          req.user._id,
            addedByName:      req.user.fullName,
          }
        },
        upsert: true,   // insert if no match found
      }
    }));

    const result = await Product.bulkWrite(ops, { ordered: false });

    const inserted = result.upsertedCount  || 0;
    const modified = result.modifiedCount  || 0;

    // ── Log import history ───────────────────────────────────────────────
    await ImportHistory.create({
      fileName:        fileName || 'unknown.xlsx',
      importedBy:      req.user._id,
      importedByName:  req.user.fullName,
      totalRecords:    totalRows      || parsedRows.length,
      newProducts:     newProducts    !== undefined ? newProducts    : inserted,
      updatedProducts: updatedProducts !== undefined ? updatedProducts : modified,
      failedRecords:   failedRecords  || 0,
      status:          'success',
    });

    res.json({
      message: `Import complete. ${inserted} new product${inserted !== 1 ? 's' : ''} added, ${modified} updated. Existing products not in this file were kept unchanged.`,
      inserted,
      modified,
      total: parsedRows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  GET /api/products/import/history  — HO + Admin only
// ════════════════════════════════════════════════════════════════════════════
router.get('/import/history', auth, requireRole(...HO_ADMIN), async (req, res) => {
  try {
    const history = await ImportHistory.find().sort({ createdAt: -1 }).limit(50).lean();
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  POST /api/products  — add single product (HO + Admin)
// ════════════════════════════════════════════════════════════════════════════
router.post('/', auth, requireRole(...HO_ADMIN), async (req, res) => {
  try {
    const { brand, category, orionCode, orionDescription, subCategory } = req.body;
    if (!brand || !category || !orionDescription) {
      return res.status(400).json({ error: 'Brand, Category and Orion Description are required.' });
    }
    const existing = await Product.findOne({ orionDescription: orionDescription.trim() });
    if (existing) return res.status(400).json({ error: 'A product with this Orion Description already exists.' });

    const product = new Product({
      brand, category, orionCode, orionDescription, subCategory,
      addedBy:     req.user._id,
      addedByName: req.user.fullName,
    });
    await product.save();
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  DELETE /api/products/:id  — Admin only
// ════════════════════════════════════════════════════════════════════════════
router.delete('/:id', auth, requireRole('System Administrator'), async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found.' });
    res.json({ message: 'Product deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;