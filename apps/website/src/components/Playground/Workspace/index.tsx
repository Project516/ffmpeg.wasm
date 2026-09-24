import React, {
  ChangeEvent,
  useState,
  useEffect,
  MutableRefObject,
} from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import { FFmpeg } from "@project516/ffmpeg-wasm";
import { fetchFile } from "@project516/ffmpeg-wasm-util";
import { downloadFile } from "@site/src/util";
import { Node } from "./types";
import FileSystemManager from "./FileSystemManager";
import { SAMPLE_FILES } from "../const";
import Editor from "./Editor";

const defaultArgs = JSON.stringify(["-i", "video.webm", "video.mp4"], null, 2);

interface WorkspaceProps {
  ffmpeg: MutableRefObject<FFmpeg>;
}

export default function Workspace({ ffmpeg: _ffmpeg }: WorkspaceProps) {
  const [path, setPath] = useState("/");
  const [nodes, setNodes] = useState<Node[]>([]);
  const [oldName, setOldName] = useState("");
  const [newName, setNewName] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [args, setArgs] = useState(defaultArgs);
  const [progress, setProgress] = useState(0);
  const [time, setTime] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [samplesLoading, setSamplesLoading] = useState(false);

  const ffmpeg = _ffmpeg.current;

  const refreshDir = async (curPath: string) => {
    if (ffmpeg.loaded) {
      setNodes(
        (await ffmpeg.listDir(curPath)).filter(({ name }) => name !== ".")
      );
    }
  };

  const onNewNameChange = () => async (event: ChangeEvent<HTMLInputElement>) => {
    setNewName(event.target.value);
  };

  const onCloseRenameModal = () => async () => {
    setRenameOpen(false);
  };

  const onFileUpload =
    (isText: boolean) =>
    async ({ target: { files } }: ChangeEvent<HTMLInputElement>) => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let data: Uint8Array | string = await fetchFile(file);
        if (isText) data = new TextDecoder().decode(data);
        await ffmpeg.writeFile(`${path}/${file.name}`, data);
      }
      refreshDir(path);
    };

  const onFileClick = (name: string) => async (option: string) => {
    const fullPath = `${path}/${name}`;
    switch (option) {
      case "rename":
        setOldName(name);
        setNewName("");
        setRenameOpen(true);
        break;
      case "download": {
        const fileData = (await ffmpeg.readFile(
          fullPath,
          "binary"
        )) as Uint8Array;
        // Copy into a plain ArrayBuffer-backed view: @project516/ffmpeg's
        // FileData type predates TS 5.7's generic typed arrays, so it widens
        // to Uint8Array<ArrayBufferLike>, which Blob's BlobPart rejects.
        downloadFile(name, new Uint8Array(fileData));
        break;
      }
      case "download-text":
        downloadFile(name, await ffmpeg.readFile(fullPath, "utf8"));
        break;
      case "delete":
        await ffmpeg.deleteFile(fullPath);
        refreshDir(path);
        break;
      default:
        break;
    }
  };

  const onDirClick = (name: string) => async () => {
    let nextPath = path;
    if (path === "/") {
      if (name !== "..") nextPath = `/${name}`;
    } else if (name === "..") {
      const cols = path.split("/");
      cols.pop();
      nextPath = cols.length === 1 ? "/" : cols.join("/");
    } else {
      nextPath = `${path}/${name}`;
    }
    setPath(nextPath);
    refreshDir(nextPath);
  };

  const onDirCreate = (name: string) => async () => {
    if (name !== "") {
      await ffmpeg.createDir(`${path}/${name}`);
    }
    refreshDir(path);
  };

  const onRename = (old_name: string, new_name: string) => async () => {
    if (old_name !== "" && new_name !== "") {
      await ffmpeg.rename(`${path}/${old_name}`, `${path}/${new_name}`);
    }
    setRenameOpen(false);
    refreshDir(path);
  };

  const onLoadSamples = async () => {
    setSamplesLoading(true);
    try {
      for (const name of Object.keys(SAMPLE_FILES)) {
        await ffmpeg.writeFile(name, await fetchFile(SAMPLE_FILES[name]));
      }
      refreshDir(path);
    } finally {
      setSamplesLoading(false);
    }
  };

  const onExec = async () => {
    setProgress(0);
    setTime(0);
    // The current core reports its exit by calling emscripten's abort(),
    // which logs a bare "Aborted()" line even on success. Drop that line
    // and report the resolved exit code ourselves instead.
    let aborted = false;
    const logListener = ({ message }) => {
      if (message.trim() === "Aborted()") {
        aborted = true;
        return;
      }
      setLogs((_logs) => [..._logs, message]);
    };
    const progListener = ({ progress: prog }) => {
      setProgress(prog * 100);
    };
    ffmpeg.on("log", logListener);
    ffmpeg.on("progress", progListener);
    const start = performance.now();
    const code = await ffmpeg.exec(JSON.parse(args));
    setTime(performance.now() - start);
    ffmpeg.off("log", logListener);
    ffmpeg.off("progress", progListener);
    setLogs((_logs) => [
      ..._logs,
      aborted
        ? `ffmpeg exited with code ${code} (aborted)`
        : `ffmpeg exited with code ${code}`,
    ]);
    refreshDir(path);
  };

  useEffect(() => {
    // Load the sample files as soon as the workspace mounts, the same way
    // the "Load Sample Files" button does, so the default command works on
    // first Run. This is not awaited so it does not block the UI; the
    // samplesLoading state below covers the download instead.
    onLoadSamples();
  }, []);

  return (
    <Box sx={{ flexGrow: 1 }}>
      <Grid container spacing={{ xs: 1 }} columns={{ xs: 4, md: 12 }}>
        <Grid size={{ xs: 4 }}>
          <FileSystemManager
            path={path}
            nodes={nodes}
            oldName={oldName}
            newName={newName}
            renameOpen={renameOpen}
            onNewNameChange={onNewNameChange}
            onCloseRenameModal={onCloseRenameModal}
            onFileUpload={onFileUpload}
            onFileClick={onFileClick}
            onDirClick={onDirClick}
            onDirCreate={onDirCreate}
            onRename={onRename}
            onLoadSamples={onLoadSamples}
            samplesLoading={samplesLoading}
            onRefresh={() => refreshDir(path)}
          />
        </Grid>
        <Grid size={{ xs: 8 }}>
          <Editor
            args={args}
            logs={logs}
            progress={progress}
            time={time}
            onArgsUpdate={(_args) => setArgs(_args)}
            onExec={onExec}
          />
        </Grid>
      </Grid>
    </Box>
  );
}
