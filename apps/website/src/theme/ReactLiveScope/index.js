import React from "react";
import { FFmpeg } from "@project516/ffmpeg";
import { fetchFile, toBlobURL } from "@project516/util";

// Add react-live imports you need here
const ReactLiveScope = {
  React,
  ...React,
  FFmpeg,
  fetchFile,
  toBlobURL,
};
export default ReactLiveScope;
