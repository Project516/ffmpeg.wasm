import React from "react";
import Stack from "@mui/material/Stack";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import HelpIcon from "@mui/icons-material/HelpOutlineOutlined";
import Tooltip from "@mui/material/Tooltip";

interface CoreSwitcherProps {
  checked: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

// The mt core needs SharedArrayBuffer, which browsers only expose on a
// cross-origin isolated page (COOP same-origin + COEP require-corp/
// credentialless). `window.crossOriginIsolated` reflects whether that is
// actually true for this page, rather than just whether the browser could
// support it in principle.
const isolationAvailable =
  typeof window !== "undefined" &&
  window.crossOriginIsolated === true &&
  typeof SharedArrayBuffer === "function";

export default function CoreSwitcher({ checked, onChange }: CoreSwitcherProps) {
  return (
    <>
      <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
        <FormGroup>
          <FormControlLabel
            control={<Switch checked={checked} onChange={onChange} />}
            label="Use Multithreading"
            disabled={!isolationAvailable}
          />
        </FormGroup>
        <Tooltip
          title={
            isolationAvailable
              ? "Multi-threaded core is faster, but unstable and not supported by all browsers."
              : "Multi-threaded core needs cross-origin isolation (SharedArrayBuffer), which this browser or page load does not have available."
          }
        >
          <IconButton aria-label="help" size="small">
            <HelpIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </>
  );
}
