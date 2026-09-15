import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const server = require("react-dom/server.node");

export const version = server.version;
export const renderToString = server.renderToString;
export const renderToStaticMarkup = server.renderToStaticMarkup;
export const renderToPipeableStream = server.renderToPipeableStream;
export const renderToReadableStream = server.renderToReadableStream;
export const resumeToPipeableStream = server.resumeToPipeableStream;
export const resume = server.resume;
