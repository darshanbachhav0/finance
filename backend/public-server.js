process.env.NODE_ENV = "production";
process.env.PORT ||= "5174";

await import("./server.js");
