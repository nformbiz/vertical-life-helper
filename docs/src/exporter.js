const Exporter = (() => {

  const isTauri = () => typeof window.__TAURI_INTERNALS__ !== 'undefined';
  const invoke  = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function downloadSingleFile(file) {
    if (isTauri()) {
      const path = await invoke('plugin:dialog|save', {
        options: { defaultPath: file.filename, filters: [{ name: 'CSV', extensions: ['csv'] }] }
      });
      if (!path) return false;
      await invoke('save_text_file', { path, data: file.content });
      return true;
    }
    triggerDownload(new Blob([file.content], { type: 'text/csv' }), file.filename);
    return true;
  }

  async function downloadAllFiles(files) {
    if (isTauri()) {
      const dir = await invoke('plugin:dialog|open', {
        options: { directory: true, title: 'Choose folder to save CSV files' }
      });
      if (!dir) return false;
      const sep = /[/\\]$/.test(dir) ? '' : '/';
      for (const file of files) {
        await invoke('save_text_file', { path: dir + sep + file.filename, data: file.content });
      }
      return true;
    }
    for (const file of files) {
      triggerDownload(new Blob([file.content], { type: 'text/csv' }), file.filename);
      await new Promise(r => setTimeout(r, 150));
    }
    return true;
  }

  async function downloadZip(files, zipName = 'vertical_life_export.zip') {
    const zip = new JSZip();
    for (const f of files) zip.file(f.filename, f.content);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    if (isTauri()) {
      const path = await invoke('plugin:dialog|save', {
        options: { defaultPath: zipName, filters: [{ name: 'ZIP Archive', extensions: ['zip'] }] }
      });
      if (!path) return false;
      const buffer = await blob.arrayBuffer();
      await invoke('save_binary_file', { path, data: [...new Uint8Array(buffer)] });
      return true;
    }
    triggerDownload(blob, zipName);
    return true;
  }

  return { downloadSingleFile, downloadAllFiles, downloadZip };
})();
