const express        = require('express');
const multer         = require('multer');
const XLSX           = require('xlsx');
const Product        = require('../models/Product');
const ImportHistory  = require('../models/ImportHistory');
const { auth, requireRole } = require('../middleware/auth');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const HO_ADMIN = ['Head Office Team', 'System Administrator'];

// ─── Flexible header matching ────────────────────────────────────────────────
// Normalises any header variation to a standard key
// "ORION CODE", "Orion Code", "orion-code", "ORION_CODE" → "ORION_CODE"
function normaliseHeader(h) {
  return String(h || '').trim().toUpperCase().replace(/[\s\-]+/g, '_');
}

// Maps normalised header → standard column name
const COLUMN_MAP = {
  'CATEGORY':          'CATEGORY',
  'BRAND':             'BRAND',
  'ORION_CODE':        'ORION_CODE',
  'ORION_DESCRIPTION': 'ORION_DESCRIPTION',
  'SUB_CATEGORY':      'SUB_CATEGORY',
  'SUB_CAT':           'SUB_CATEGORY',
};

const REQUIRED_STANDARD = ['CATEGORY', 'BRAND', 'ORION_CODE', 'ORION_DESCRIPTION', 'SUB_CATEGORY'];

// ─── Parse sheet with flexible headers + skip blank leading rows/cols ────────
function parseSheet(ws) {
  // sheet_to_json with header:1 gives raw arrays, we find the header row ourselves
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Find the first row that contains at least 2 non-empty cells (the header row)
  let headerRowIdx = -1;
  let headerMap    = {};   // original header text → standard column name

  for (let i = 0; i < raw.length; i++) {
    const row       = raw[i];
    const nonEmpty  = row.filter(c => c !== '' && c !== null && c !== undefined);
    if (nonEmpty.length < 2) continue;

    // Try to match at least 2 of our known columns
    const tentativeMap = {};
    row.forEach(cell => {
      const norm = normaliseHeader(cell);
      if (COLUMN_MAP[norm]) tentativeMap[String(cell).trim()] = COLUMN_MAP[norm];
    });

    if (Object.keys(tentativeMap).length >= 2) {
      headerRowIdx = i;
      headerMap    = tentativeMap;
      break;
    }
  }

  if (headerRowIdx === -1) return { headerMap: {}, rows: [] };

  // Build data rows from rows after the header
  const headers = raw[headerRowIdx];
  const rows = [];

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const cells = raw[i];
    // Skip fully blank rows
    if (cells.every(c => c === '' || c === null || c === undefined)) continue;

    const rowObj = {};
    headers.forEach((h, colIdx) => {
      const std = headerMap[String(h).trim()];
      if (std) rowObj[std] = cells[colIdx] !== undefined ? cells[colIdx] : '';
    });
    rows.push(rowObj);
  }

  return { headerMap, rows };
}

// ─── Helper: normalise a parsed row → product object ────────────────────────
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
    if (brand)       filter.brand        = { $regex: brand,       $options: 'i' };
    if (category)    filter.category     = { $regex: category,    $options: 'i' };
    if (orionCode)   filter.orionCode    = { $regex: orionCode,   $options: 'i' };
    if (subCategory) filter.subCategory  = { $regex: subCategory, $options: 'i' };
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
  const ws = XLSX.utils.aoa_to_sheet([['CATEGORY', 'BRAND', 'ORION CODE', 'ORION DESCRIPTION', 'SUB-CATEGORY']]);
  ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 36 }, { wch: 16 }];
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

    const { headerMap, rows } = parseSheet(ws);

    if (!rows.length) return res.status(400).json({ error: 'The Excel file is empty or no data rows found.' });

    // Check which required columns were detected
    const foundStandard = new Set(Object.values(headerMap));
    const missing = REQUIRED_STANDARD.filter(c => !foundStandard.has(c));
    if (missing.length) {
      return res.status(400).json({
        error: `Missing required columns: ${missing.join(', ')}. ` +
               `Detected columns: ${Object.keys(headerMap).join(', ') || 'none'}`
      });
    }

    // Parse & validate each row
    const valid   = [];
    const invalid = [];
    const dupMap  = new Map();
    const dupRows = [];

    rows.forEach((raw, idx) => {
      const p    = rowToProduct(raw);
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

    // Cross-check with existing DB
    const existingDescs = new Set(
      (await Product.find({}, 'orionDescription').lean()).map(p => p.orionDescription.toLowerCase())
    );
    const newProducts     = valid.filter(p => !existingDescs.has(p.orionDescription.toLowerCase()));
    const updatedProducts = valid.filter(p =>  existingDescs.has(p.orionDescription.toLowerCase()));

    res.json({
      fileName:         req.file.originalname,
      totalRows:        rows.length,
      validProducts:    valid.length,
      newProducts:      newProducts.length,
      updatedProducts:  updatedProducts.length,
      duplicateRows:    dupRows.length,
      invalidRows:      invalid.length,
      preview:          valid.slice(0, 20),
      invalidDetails:   invalid.slice(0, 20),
      duplicateDetails: dupRows.slice(0, 20),
      _parsedRows:      valid,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  POST /api/products/import/confirm
//  Upserts products — new ones inserted, existing ones updated,
//  products NOT in the sheet are left completely untouched.
// ════════════════════════════════════════════════════════════════════════════
router.post('/import/confirm', auth, requireRole(...HO_ADMIN), async (req, res) => {
  try {
    const { parsedRows, fileName, totalRows, newProducts, updatedProducts, failedRecords } = req.body;
    if (!Array.isArray(parsedRows) || !parsedRows.length) {
      return res.status(400).json({ error: 'No product data to import.' });
    }

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
        upsert: true,
      }
    }));

    const result = await Product.bulkWrite(ops, { ordered: false });

    const inserted = result.upsertedCount  || 0;
    const modified = result.modifiedCount  || 0;

    await ImportHistory.create({
      fileName:        fileName || 'unknown.xlsx',
      importedBy:      req.user._id,
      importedByName:  req.user.fullName,
      totalRecords:    totalRows       || parsedRows.length,
      newProducts:     newProducts     !== undefined ? newProducts     : inserted,
      updatedProducts: updatedProducts !== undefined ? updatedProducts : modified,
      failedRecords:   failedRecords   || 0,
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