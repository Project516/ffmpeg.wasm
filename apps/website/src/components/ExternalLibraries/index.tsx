import React from "react";
import clsx from "clsx";
import useBaseUrl from "@docusaurus/useBaseUrl";
import styles from "./styles.module.css";

interface LibraryItem {
  title: string;
  desc: string;
  /** Path under static/, e.g. "/img/libs/x264.png". */
  img?: string;
  isBlackBackground?: boolean;
}

const libs: LibraryItem[] = [
  {
    title: "x264",
    desc: "H.264 Codec",
    img: "/img/libs/x264.png",
    isBlackBackground: true,
  },
  {
    title: "x265",
    desc: "H.265 codec",
    img: "/img/libs/x265.webp",
  },
  {
    title: "libvpx",
    desc: "VP8/VP9 codec",
    img: "/img/libs/libvpx.png",
  },
  {
    title: "theora",
    desc: "OGV codec",
    img: "/img/libs/theora.png",
  },
  {
    title: "lame",
    desc: "MP3 codec",
    img: "/img/libs/lame.gif",
  },
  {
    title: "vorbis",
    desc: "OGG codec",
    img: "/img/libs/vorbis.png",
  },
  {
    title: "opus",
    desc: "OPUS codec",
    img: "/img/libs/opus.png",
  },
  {
    title: "freetype2",
    desc: "Font file renderer",
    img: "/img/libs/freetype.png",
  },
  {
    title: "libass",
    desc: "Subtitle renderer",
  },
  {
    title: "libwebp",
    desc: "WEBP codec",
    img: "/img/libs/webp.png",
  },
  {
    title: "dav1d",
    desc: "AV1 decoder",
    img: "/img/libs/dav1d.svg",
  },
  {
    title: "harfbuzz",
    desc: "Text shaping",
    img: "/img/libs/harfbuzz.svg",
  },
  {
    title: "fribidi",
    desc: "Bidirectional text",
  },
  {
    title: "zimg",
    desc: "Scaling (zscale filter)",
  },
];

const Library: React.FC<LibraryItem> = ({
  title,
  desc,
  img,
  isBlackBackground = false,
}) => {
  const src = useBaseUrl(img ?? "");
  return (
    <div className={clsx("col col--2")}>
      <div className="text--center">
        {img ? (
          <img
            src={src}
            alt={title}
            className={clsx(
              styles.libraryImg,
              isBlackBackground && styles.blackBackground
            )}
          />
        ) : (
          <div className={styles.textTile}>{title}</div>
        )}
      </div>
      <div className="text--center padding-horiz--md">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
    </div>
  );
};

export default function ExternalLibraries(): React.JSX.Element {
  return (
    <section className={styles.libraries}>
      <div className="container">
        <h1 className="text--center">External Libraries</h1>
        <h4 className="text--center">
          {" "}
          ffmpeg.wasm is built with common external libraries, and more of
          libraries to be added!
        </h4>
        <div className="row">
          {libs.map((props, idx) => (
            <Library {...props} key={idx} />
          ))}
        </div>
      </div>
    </section>
  );
}
