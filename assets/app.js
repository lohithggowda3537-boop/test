const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

const statuses = {
  open: ['Open', 'status open'],
  in_progress: ['In progress', 'status'],
  resolved: ['Resolved', 'status resolved'],
};

function statusFor(value) {
  return statuses[value] || statuses.open;
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return response.json();
}

$('#reportSub').textContent = 'Share the location and details. Your report is saved to the Gundi Watch database.';
$('#modeNotice').textContent = 'No complaint is sent to a government department. Your report details and photo are visible to other visitors.';
$('#submitBtn').textContent = 'Submit report →';
$('#trackSub').textContent = 'Enter your report ID (for example GW-123456) to see its status.';
$('#smallprint').textContent = 'Gundi Watch citizen tool · Reports are stored in a shared database · Not an official government service';

$('#area').maxLength = 120;
$('#road').maxLength = 160;
$('#details').maxLength = 1000;

let photoBlob = null;
let previewUrl = null;

function clearPhoto() {
  photoBlob = null;
  $('#photo').value = '';
  $('#photoPreview').style.display = 'none';
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

$('#photo').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  const notice = $('#submitNotice');
  if (!file) {
    clearPhoto();
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    clearPhoto();
    notice.style.display = 'block';
    notice.textContent = 'That photo is over 10 MB. Choose a smaller one.';
    return;
  }

  let imageUrl;
  try {
    imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.src = imageUrl;
    await image.decode();

    const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not process this photo.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    photoBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not process this photo.'));
      }, 'image/jpeg', 0.78);
    });

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(photoBlob);
    $('#photoPreview').src = previewUrl;
    $('#photoPreview').style.display = 'block';
  } catch (error) {
    clearPhoto();
    notice.style.display = 'block';
    notice.textContent = "This photo couldn't be processed. Try a JPG or PNG.";
  } finally {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
  }
});

$('#reportForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#submitBtn');
  const notice = $('#submitNotice');
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving…';

  try {
    const formData = new FormData();
    formData.set('area', $('#area').value.trim());
    formData.set('road', $('#road').value.trim());
    formData.set('severity', $('#severity').value);
    formData.set('details', $('#details').value.trim());
    if (photoBlob) formData.set('photo', photoBlob, 'pothole.jpg');

    const result = await request('/api/reports', { method: 'POST', body: formData });
    notice.style.display = 'block';
    notice.innerHTML = `<b>Report saved!</b><br>Your report ID is <strong>${escapeHtml(result.id)}</strong>. Save this ID to track it. No official complaint was submitted.`;
    $('#trackId').value = result.id;
    $('#reportForm').reset();
    clearPhoto();
    await Promise.all([renderReports(), renderStats()]);
  } catch (error) {
    console.error(error);
    notice.style.display = 'block';
    notice.textContent = "Couldn't save your report. Check your connection and try again. Your details are still in the form.";
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
});

async function renderReports() {
  const list = $('#reportsList');
  try {
    const reports = await request('/api/reports?limit=5');
    if (!reports.length) {
      list.innerHTML = '<p class="sub">No reports yet. Be the first to report a pothole.</p>';
      return;
    }

    list.innerHTML = reports.map((report) => {
      const currentStatus = statusFor(report.status);
      const thumbnail = report.photo
        ? `<img src="${escapeHtml(report.photo)}" alt="" loading="lazy">`
        : '⌖';
      return `<a class="report" href="#track" data-report-id="${escapeHtml(report.id)}"><div class="thumb">${thumbnail}</div><div class="report-info"><b>${escapeHtml(report.road)}, ${escapeHtml(report.area)}</b><small>${escapeHtml(report.id)} · ${escapeHtml(report.date)}</small></div><span class="${currentStatus[1]}">${currentStatus[0]}</span></a>`;
    }).join('');
  } catch (error) {
    console.error(error);
    list.innerHTML = '<p class="sub">Could not load recent reports.</p><button class="btn btn-light" type="button" data-retry-reports>Try again</button>';
  }
}

$('#reportsList').addEventListener('click', (event) => {
  const retryButton = event.target.closest('[data-retry-reports]');
  if (retryButton) {
    renderReports();
    return;
  }

  const reportLink = event.target.closest('[data-report-id]');
  if (reportLink) {
    $('#trackId').value = reportLink.dataset.reportId;
    $('#trackBtn').click();
  }
});

async function renderStats() {
  try {
    const stats = await request('/api/stats');
    $('#stat-total').textContent = stats.total.toLocaleString();
    $('#stat-resolved').textContent = stats.resolved.toLocaleString();
    $('#stat-3').textContent = stats.open.toLocaleString();
    $('#stat-3-label').textContent = 'Open reports';
  } catch (error) {
    console.error(error);
  }
}

$('#trackBtn').addEventListener('click', async () => {
  const id = $('#trackId').value.trim().toUpperCase();
  const notice = $('#trackNotice');
  notice.style.display = 'block';
  if (!/^GW-\d{6}$/.test(id)) {
    notice.textContent = 'Enter an ID in this format: GW-123456.';
    return;
  }

  notice.textContent = 'Searching…';
  try {
    const report = await request(`/api/reports/${encodeURIComponent(id)}`);
    const currentStatus = statusFor(report.status);
    notice.innerHTML = report.found
      ? `<b>${escapeHtml(report.id)} · ${currentStatus[0]}</b><br>${escapeHtml(report.road)}, ${escapeHtml(report.area)}<br><small>Status is updated by the Gundi Watch team. It is not an official government status.</small>`
      : 'No report found for that ID. Check the ID and try again.';
  } catch (error) {
    console.error(error);
    notice.textContent = "Couldn't reach the database. Try again in a moment.";
  }
});

$('#authorityBtn').addEventListener('click', () => {
  const area = $('#authorityArea').value.trim();
  const type = $('#roadType').value;
  const guidance = {
    city: 'BBMP may be responsible for this city road. Verify the exact ward and road jurisdiction before submitting.',
    national: 'NHAI or another highway authority may be responsible, depending on the highway section. Verify the road operator.',
    state: 'Karnataka PWD or another state/local agency may be responsible. Verify the road classification.',
    metro: 'BMRCL or the relevant road agency may be responsible around project works. Verify the exact location.',
  };
  const notice = $('#authorityNotice');
  notice.style.display = 'block';
  notice.textContent = `${area ? `For ${area}: ` : 'For this road: '}${guidance[type]} This demo does not verify jurisdiction automatically.`;
});

let kannada = false;
$('#langBtn').addEventListener('click', () => {
  kannada = !kannada;
  document.documentElement.lang = kannada ? 'kn' : 'en';
  $('#langBtn').textContent = kannada ? 'English' : 'ಕನ್ನಡ';
  document.querySelectorAll('[data-en][data-kn]').forEach((element) => {
    element.textContent = kannada ? element.dataset.kn : element.dataset.en;
  });
  document.querySelectorAll('[data-en-html][data-kn-html]').forEach((element) => {
    element.innerHTML = kannada ? element.dataset.knHtml : element.dataset.enHtml;
  });
});

renderReports();
renderStats();
