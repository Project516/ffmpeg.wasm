import * as React from "react";
import Typography from "@mui/material/Typography";
import Container from "@mui/material/Container";
import LinearProgressWithLabel from "@site/src/components/common/LinearProgressWithLabel";
import { CORE_SIZE } from "./const";

export default function CoreDownloader({ url, received, total: reported }) {
  const known = reported > 0 ? reported : CORE_SIZE[url];
  const total = known >= received ? known : 0;
  const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  return (
    <Container>
      <Typography>{`Downloading ${url}`}</Typography>
      <Typography>{`(${received} / ${total > 0 ? total : "unknown"} bytes)`}</Typography>
      <LinearProgressWithLabel value={percent} />
    </Container>
  );
}
