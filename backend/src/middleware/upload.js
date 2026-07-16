import fs from "fs";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { AppError } from "../utils/AppError.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRoot = path.resolve(__dirname, "..", "..", "uploads");

fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadRoot, { recursive: true });
    cb(null, uploadRoot);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9-_]/g, "-")
      .slice(0, 60);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${base}${ext}`);
  }
});

const allowed = new Set([".xml", ".pdf", ".txt", ".csv", ".json", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xlsx"]);

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.has(ext)) {
    cb(new AppError(400, `File type ${ext || "unknown"} is not allowed.`));
    return;
  }
  cb(null, true);
}

export const uploadFields = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
}).fields([
  { name: "xml", maxCount: 1 },
  { name: "pdf", maxCount: 1 },
  { name: "quotation", maxCount: 2 },
  { name: "supporting", maxCount: 8 },
  { name: "rendition", maxCount: 8 }
]);
