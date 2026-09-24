import React from "react";
import { FFmpeg } from "@project516/ffmpeg-wasm";
import { fetchFile, toBlobURL } from "@project516/ffmpeg-wasm-util";

// Add react-live imports you need here
const ReactLiveScope = {
  React,
  ...React,
  FFmpeg,
  fetchFile,
  toBlobURL,
};
export default ReactLiveScope;
