process.env.NODE_ENV = "production";
process.env.PORT ||= "5050";

await import("./server.js");
