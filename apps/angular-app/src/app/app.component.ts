import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { FFmpeg } from '@project516/ffmpeg';
import { fetchFile, toBlobURL } from '@project516/util';

const baseURL = 'https://cdn.jsdelivr.net/npm/@project516/core-mt@0.12.10/dist/esm';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  loaded = false;
  ffmpeg = new FFmpeg();
  videoURL = '';
  message = '';
  async load() {
    this.ffmpeg.on('log', ({ message }) => {
      this.message = message;
    });
    await this.ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.wasm`,
        'application/wasm',
      ),
      workerURL: await toBlobURL(
        `${baseURL}/ffmpeg-core.worker.js`,
        'text/javascript',
      ),
    });
    this.loaded = true;
  }
  async transcode() {
    const videoURL =
      'https://raw.githubusercontent.com/ffmpegwasm/testdata/master/video-15s.avi';
    await this.ffmpeg.writeFile('input.avi', await fetchFile(videoURL));
    await this.ffmpeg.exec(['-i', 'input.avi', 'output.mp4']);
    const fileData = await this.ffmpeg.readFile('output.mp4');
    const data = new Uint8Array(fileData as Uint8Array);
    this.videoURL = URL.createObjectURL(
      new Blob([data], { type: 'video/mp4' }),
    );
  }
}
