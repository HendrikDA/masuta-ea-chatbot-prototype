import multer from "multer";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/uploads";

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      // keep original file name
      cb(null, file.originalname);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.toLowerCase().endsWith(".xml");
    cb(null, ok);
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // adjust if needed
});
