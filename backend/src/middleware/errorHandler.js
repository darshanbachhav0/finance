import { AppError } from "../utils/AppError.js";

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

export function errorHandler(error, _req, res, _next) {
  let statusCode = error.statusCode || 500;
  let message = error.message || "Internal server error";
  let details = error.details;

  if (error.code === 11000) {
    statusCode = 409;
    message = "Duplicate value violates a unique constraint.";
    details = error.keyValue;
  }

  if (error.name === "ValidationError") {
    statusCode = 422;
    message = "Validation failed.";
    details = Object.values(error.errors).map((item) => item.message);
  }

  const payload = {
    message
  };

  if (details) payload.details = details;
  if (process.env.NODE_ENV !== "production" && statusCode >= 500) {
    payload.stack = error.stack;
  }

  res.status(statusCode).json(payload);
}
