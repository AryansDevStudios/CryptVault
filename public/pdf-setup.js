import * as pdfjsLib from './lib/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
