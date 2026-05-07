const form = document.getElementById("media-form");
const urlInput = document.getElementById("url");
const statusDiv = document.getElementById("status");
const resultsDiv = document.getElementById("results");

let selectedFormatId = null;
let selectedFormatGroup = null;
let selectedFormatData = null;
let currentMediaDuration = 0;
let isProcessing = false;

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "Unknown";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return [hrs, mins, secs]
    .map((num) => String(num).padStart(2, "0"))
    .join(":");
}
function enforceTimestampFormat(input) {
  input.addEventListener("input", () => {
    let val = input.value.replace(/[^0-9]/g, "");
    if (val.length >= 3) val = val.slice(0, 2) + ":" + val.slice(2);
    if (val.length >= 6) val = val.slice(0, 5) + ":" + val.slice(5);
    input.value = val.slice(0, 8);
  });
}
function isValidTimestampFormat(value) {
  return /^\d{2}:\d{2}:\d{2}$/.test(value.trim());
}

function formatBytes(bytes) {
  if (!bytes) return "Unknown";
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let value = bytes;

  while (value >= 1024 && i < sizes.length - 1) {
    value /= 1024;
    i++;
  }

  return `${value.toFixed(1)} ${sizes[i]}`;
}

function getResolution(format) {
  if (format.resolution) return format.resolution;
  if (format.width && format.height) return `${format.width}x${format.height}`;
  if (format.vcodec === "none") return "audio only";
  return "Unknown";
}

function parseTimestamp(value) {
  if (!value) return null;

  const parts = value.trim().split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    if (minutes > 59 || seconds > 59) return null;
    return hours * 3600 + minutes * 60 + seconds;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    if (seconds > 59) return null;
    return minutes * 60 + seconds;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return null;
}

function renderFormatTable(title, formats, groupName) {
  if (!formats.length) {
    return `<h3>${title}</h3><p>No formats found.</p>`;
  }

  const isVideo = groupName === "video";

  const rowsHtml = formats
    .map((format, index) => `
      <tr>
        <td class="radio-cell">
          <input
            type="radio"
            name="format_choice"
            value="${format.format_id}"
            data-group="${groupName}"
            data-index="${index}"
          />
        </td>
        <td>${format.ext ?? "N/A"}</td>
        ${isVideo ? `<td>${getResolution(format)}</td>` : `<td>audio only</td>`}
        <td>${format.filesize ? formatBytes(format.filesize) : "Unknown"}</td>
        ${
          isVideo
            ? `<td class="codec-cell">${format.vcodec ?? "—"}</td>`
            : `<td class="codec-cell">${format.acodec ?? "—"}</td>`
        }
      </tr>
    `)
    .join("");

  return `
    <h3>${title}</h3>
    <div class="table-wrap">
      <table class="formats-table">
        <thead>
          <tr>
            <th class="radio-cell">Pick</th>
            <th>Format</th>
            ${isVideo ? "<th>Resolution</th>" : "<th>Type</th>"}
            <th>Filesize</th>
            <th>${isVideo ? "Video Codec" : "Audio Codec"}</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

function renderSelectionControls() {
  const selectedBox = document.getElementById("selected-format-box");
  if (!selectedBox || !selectedFormatData) return;

  const isVideo = selectedFormatGroup === "video";

  selectedBox.innerHTML = `
    <div class="selected-card">
      <h3>Selected Format</h3>
      <p><strong>Format ID:</strong> ${selectedFormatData.format_id}</p>
      <p><strong>Format:</strong> ${selectedFormatData.ext ?? "N/A"}</p>
      ${
        isVideo
          ? `<p><strong>Resolution:</strong> ${getResolution(selectedFormatData)}</p>
             <p><strong>Video Codec:</strong> ${selectedFormatData.vcodec ?? "—"}</p>`
          : `<p><strong>Audio Codec:</strong> ${selectedFormatData.acodec ?? "—"}</p>`
      }

      <div class="clip-controls">
        <h4>${isVideo ? "Video Clip Settings" : "Audio Download Settings"}</h4>

        ${
          isVideo
            ? `<p class="hint">Video clips must be 3 minutes or less.</p>`
            : `<label class="checkbox-row">
                 <input type="checkbox" id="full-audio-checkbox" />
                 Download full audio
               </label>
               <p class="hint">Leave the box unchecked to trim audio using timestamps.</p>`
        }

        <label for="start-time">Start time</label>
        <input type="text" id="start-time" placeholder="00:00:00" maxlength="8" />

        <label for="end-time">End time</label>
        <input type="text" id="end-time" placeholder="${isVideo ? "00:03:00" : "00:30:00"}" maxlength="8" />

        <button type="button" id="validate-selection-btn" class="secondary">Validate</button>
        <button type="button" id="process-selection-btn">Download</button>

        <div id="selection-validation-message"></div>
      </div>
    </div>
  `;

  if (!isVideo) {
    const fullAudioCheckbox = document.getElementById("full-audio-checkbox");
    const startInput = document.getElementById("start-time");
    const endInput = document.getElementById("end-time");

    fullAudioCheckbox.addEventListener("change", () => {
      const checked = fullAudioCheckbox.checked;
      startInput.disabled = checked;
      endInput.disabled = checked;

      if (checked) {
        startInput.value = "";
        endInput.value = "";
      }

  
    });
  }

  document.getElementById("validate-selection-btn").addEventListener("click", validateSelection);
  document.getElementById("process-selection-btn").addEventListener("click", processSelection);

  enforceTimestampFormat(document.getElementById("start-time"));
  enforceTimestampFormat(document.getElementById("end-time"));
}

function validateSelection() {
  const messageDiv = document.getElementById("selection-validation-message");
  if (!messageDiv || !selectedFormatData) return false;

  const isVideo = selectedFormatGroup === "video";
  const startInput = document.getElementById("start-time");
  const endInput = document.getElementById("end-time");

  if (!startInput || !endInput) return false;

  if (!isVideo) {
    const fullAudioCheckbox = document.getElementById("full-audio-checkbox");
    const fullAudio = fullAudioCheckbox?.checked;

    if (fullAudio) {
      messageDiv.innerHTML = `<p class="success-text">Looks good. Full audio download selected.</p>`;
      return true;
    }
  }
  if (!isValidTimestampFormat(startInput.value) || !isValidTimestampFormat(endInput.value)) {
    messageDiv.innerHTML = `<p class="error-text">Please enter timestamps in 00:00:00 format.</p>`;
    return false;
  }

  const startSeconds = parseTimestamp(startInput.value);
  const endSeconds = parseTimestamp(endInput.value);
  
  if (startSeconds === null || endSeconds === null) {
    messageDiv.innerHTML = `<p class="error-text">Please enter valid timestamps like 00:01:30.</p>`;
    return false;
  }

  if (endSeconds <= startSeconds) {
    messageDiv.innerHTML = `<p class="error-text">End time must be greater than start time.</p>`;
    return false;
  }

  if (endSeconds > currentMediaDuration) {
    messageDiv.innerHTML = `<p class="error-text">End time cannot be greater than the media duration.</p>`;
    return false;
  }

  const clipLength = endSeconds - startSeconds;

  if (isVideo && clipLength > 3 * 60) {
    messageDiv.innerHTML = `<p class="error-text">Video clips cannot be longer than 3 minutes.</p>`;
    return false;
  }

  messageDiv.innerHTML = `<p class="success-text">Looks good. Your selection is valid.</p>`;
  return true;
}

function setProcessingState(isBusy) {
  isProcessing = isBusy;
  const processButton = document.getElementById("process-selection-btn");
  const validateButton = document.getElementById("validate-selection-btn");

  if (processButton) {
    processButton.disabled = isBusy;
    processButton.textContent = isBusy ? "Processing..." : "Download";
  }

  if (validateButton) {
    validateButton.disabled = isBusy;
  }
}

async function processSelection() {
  if (isProcessing) return;

  const messageDiv = document.getElementById("selection-validation-message");
  if (!messageDiv || !selectedFormatData) return;

  const isValid = validateSelection();
  if (!isValid) return;

  const startInput = document.getElementById("start-time");
  const endInput = document.getElementById("end-time");
  const fullAudioCheckbox = document.getElementById("full-audio-checkbox");

  const payload = {
    url: urlInput.value.trim(),
    format_id: selectedFormatId,
    media_type: selectedFormatGroup,
    start_time: startInput ? startInput.value.trim() : "",
    end_time: endInput ? endInput.value.trim() : "",
    full_audio: fullAudioCheckbox ? fullAudioCheckbox.checked : false,
    duration: currentMediaDuration,
  };

  setProcessingState(true);
  messageDiv.innerHTML = `<p class="hint">Processing your file. This can take up to 5 minutes for longer media.</p>`;

  try {
    const response = await fetch("/api/process", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      messageDiv.innerHTML = `<p class="error-text">${data.error || "Processing failed."}</p>`;
      return;
    }

    messageDiv.innerHTML = `
      <p class="success-text">Done. Your file is ready.</p>
      <p><a href="${data.download_url}" download>Download your file</a></p>
    `;
  } catch (error) {
    console.error(error);
    messageDiv.innerHTML = `<p class="error-text">Processing failed.</p>`;
  } finally {
    setProcessingState(false);
  }
}

function attachRadioListeners(videoFormats, audioFormats) {
  document.querySelectorAll('input[name="format_choice"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      const group = radio.dataset.group;
      const index = Number(radio.dataset.index);

      const selected =
        group === "video" ? videoFormats[index] : audioFormats[index];

      selectedFormatId = selected.format_id;
      selectedFormatGroup = group;
      selectedFormatData = selected;

      renderSelectionControls();
    });
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = urlInput.value.trim();
  resultsDiv.innerHTML = "";
  statusDiv.textContent = "";
  selectedFormatId = null;
  selectedFormatGroup = null;
  selectedFormatData = null;
  currentMediaDuration = 0;
  isProcessing = false;

  if (!url) {
    statusDiv.textContent = "Please paste a URL.";
    return;
  }

  statusDiv.textContent = "Fetching media info...";

  try {
    const response = await fetch("/api/info", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    });

    const data = await response.json();

    if (!response.ok) {
      statusDiv.textContent = data.error || "Something went wrong.";
      return;
    }

    const videoFormats = data.video_formats || [];
    const audioFormats = data.audio_formats || [];
    currentMediaDuration = data.duration || 0;

    statusDiv.textContent = "Success.";

    resultsDiv.innerHTML = `
      <h2>${data.title}</h2>
      <p><strong>Duration:</strong> ${formatDuration(data.duration)}</p>

      ${renderFormatTable("Video Formats", videoFormats, "video")}
      ${renderFormatTable("Audio Formats", audioFormats, "audio")}

      <div id="selected-format-box" style="margin-top: 16px;"></div>
    `;

    attachRadioListeners(videoFormats, audioFormats);
  } catch (error) {
    statusDiv.textContent = "Failed to fetch media info.";
    console.error(error);
  }
});