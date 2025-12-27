import multer from "multer";
import path from "path";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/uploads";

function normalizeXmlFilename(fileName: string) {
  const normalized = fileName
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!/^[A-Za-z0-9._-]+\.xml$/i.test(normalized)) {
    throw new Error("Invalid filename. Use something like 'BOM.xml'.");
  }

  return normalized;
}

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      try {
        const safe = normalizeXmlFilename(path.basename(file.originalname));
        cb(null, safe);
      } catch (e: any) {
        cb(e, "");
      }
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.toLowerCase().endsWith(".xml");
    cb(null, ok);
  },
  limits: { fileSize: 50 * 1024 * 1024 },
});
