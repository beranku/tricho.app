// Gallery management

import { loadPhotos, deletePhoto, computeTotals, formatBytes, type PhotoRecord } from './storage';
import { getSessionGapMs, getSettings, getMaxPhotos, getMaxBytes } from './settings';

export interface Session {
  start: number;
  photos: PhotoRecord[];
}

let sessions: Session[] = [];
let activeSessionIndex = 0;

// DOM element references (set by main.ts)
let galleryCard: HTMLElement;
let galleryGrid: HTMLElement;
let gallerySummary: HTMLElement;
let sessionList: HTMLElement;
let photoCountHint: HTMLElement;
let cleanupResult: HTMLElement;
let monthsInput: HTMLInputElement;

export function initGalleryElements(elements: {
  galleryCard: HTMLElement;
  galleryGrid: HTMLElement;
  gallerySummary: HTMLElement;
  sessionList: HTMLElement;
  photoCountHint: HTMLElement;
  cleanupResult: HTMLElement;
  monthsInput: HTMLInputElement;
}) {
  galleryCard = elements.galleryCard;
  galleryGrid = elements.galleryGrid;
  gallerySummary = elements.gallerySummary;
  sessionList = elements.sessionList;
  photoCountHint = elements.photoCountHint;
  cleanupResult = elements.cleanupResult;
  monthsInput = elements.monthsInput;
}

export function updateGallerySummary(photos: PhotoRecord[]) {
  const { count, bytes } = computeTotals(photos);
  if (!count) {
    gallerySummary.textContent = 'Zatím žádné snímky.';
    photoCountHint.textContent = '';
    return;
  }
  gallerySummary.textContent = 'Snímků: ' + count + ', ~' + formatBytes(bytes) + '.';
  photoCountHint.textContent = count + ' snímků v úložišti.';
}

export function buildSessions(photos: PhotoRecord[]): Session[] {
  if (!photos || photos.length === 0) return [];

  const sorted = photos.slice().sort((a, b) => a.createdAt - b.createdAt);

  const sessionsArr: Session[] = [];
  let current: Session = { start: sorted[0].createdAt, photos: [sorted[0]] };
  const sessionGapMs = getSessionGapMs();

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.createdAt - prev.createdAt > sessionGapMs) {
      sessionsArr.push(current);
      current = { start: cur.createdAt, photos: [cur] };
    } else {
      current.photos.push(cur);
    }
  }
  sessionsArr.push(current);

  // Sort photos within sessions newest first
  sessionsArr.forEach((s) => {
    s.photos.sort((a, b) => b.createdAt - a.createdAt);
  });

  // Sort sessions newest first
  sessionsArr.sort((a, b) => b.start - a.start);

  return sessionsArr;
}

export function renderSessionList() {
  sessionList.innerHTML = '';

  if (!sessions.length) {
    const div = document.createElement('div');
    div.className = 'session-empty';
    div.textContent = 'Žádná sezení.';
    sessionList.appendChild(div);
    return;
  }

  sessions.forEach((s, index) => {
    const item = document.createElement('div');
    item.className = 'session-item' + (index === activeSessionIndex ? ' active' : '');

    const startDate = new Date(s.start);
    const title = document.createElement('div');
    title.className = 'session-title';
    title.textContent = startDate.toLocaleDateString();

    const endTime = s.photos[0] ? new Date(s.photos[0].createdAt) : startDate;
    const startTimeText = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTimeText = endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const meta = document.createElement('div');
    meta.className = 'session-meta';
    meta.textContent = startTimeText + ' – ' + endTimeText + ' • ' + s.photos.length;

    item.appendChild(title);
    item.appendChild(meta);

    item.addEventListener('click', () => {
      activeSessionIndex = index;
      renderSessionList();
      renderSessionPhotos();
    });

    sessionList.appendChild(item);
  });
}

export function renderSessionPhotos() {
  galleryGrid.innerHTML = '';

  if (!sessions.length) {
    const empty = document.createElement('div');
    empty.textContent = 'Zatím žádné snímky.';
    empty.style.fontSize = '0.8rem';
    empty.style.color = '#6b7280';
    galleryGrid.appendChild(empty);
    return;
  }

  const session = sessions[activeSessionIndex] || sessions[0];
  const settings = getSettings();

  session.photos.forEach((photo) => {
    const card = document.createElement('div');
    card.className = 'photo-card';

    const img = document.createElement('img');
    const url = URL.createObjectURL(photo.blob);
    img.src = url;
    img.onload = () => {
      URL.revokeObjectURL(url);
    };

    const meta = document.createElement('div');
    meta.className = 'photo-meta';
    const d = new Date(photo.createdAt);
    meta.textContent = d.toLocaleString();

    const del = document.createElement('button');
    del.className = 'delete-button';
    del.type = 'button';
    del.textContent = 'Smazat';
    del.addEventListener('click', async () => {
      if (settings.confirmDelete) {
        if (!confirm('Opravdu smazat tento snímek?')) {
          return;
        }
      }
      await deletePhoto(photo.id!);
      await renderGallery();
    });

    card.appendChild(img);
    card.appendChild(meta);
    card.appendChild(del);
    galleryGrid.appendChild(card);
  });
}

export async function renderGallery() {
  try {
    const photos = await loadPhotos();
    galleryGrid.innerHTML = '';
    sessionList.innerHTML = '';
    cleanupResult.textContent = '';

    updateGallerySummary(photos);

    if (!photos || photos.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Zatím žádné snímky.';
      empty.style.fontSize = '0.8rem';
      empty.style.color = '#6b7280';
      galleryGrid.appendChild(empty);

      const emptySess = document.createElement('div');
      emptySess.className = 'session-empty';
      emptySess.textContent = 'Žádná sezení.';
      sessionList.appendChild(emptySess);
      return;
    }

    sessions = buildSessions(photos);

    if (!sessions.length) {
      const empty = document.createElement('div');
      empty.textContent = 'Zatím žádné snímky.';
      empty.style.fontSize = '0.8rem';
      empty.style.color = '#6b7280';
      galleryGrid.appendChild(empty);
      return;
    }

    if (activeSessionIndex >= sessions.length) activeSessionIndex = 0;
    renderSessionList();
    renderSessionPhotos();
  } catch (e) {
    console.error(e);
  }
}

export async function cleanupOlderThanMonths() {
  cleanupResult.textContent = '';

  if (!monthsInput) return;
  const val = parseInt(monthsInput.value, 10);
  if (!val || val <= 0) {
    cleanupResult.textContent = 'Zadej počet měsíců.';
    return;
  }

  const months = Math.min(Math.max(val, 1), 120);
  const cutoff = Date.now() - months * 30 * 24 * 60 * 60 * 1000;

  try {
    const photos = await loadPhotos();
    if (!photos.length) {
      cleanupResult.textContent = 'Žádné snímky k mazání.';
      return;
    }

    const { count: totalCount } = computeTotals(photos);
    const toDelete = photos.filter((p) => p.createdAt < cutoff);

    if (!toDelete.length) {
      cleanupResult.textContent = 'Nic staršího než ' + months + ' měsíců.';
      return;
    }

    let freedBytes = 0;
    for (const photo of toDelete) {
      const b = (photo.blob && photo.blob.size) || photo.size || 0;
      freedBytes += b;
      await deletePhoto(photo.id!);
    }

    const percent = ((toDelete.length / totalCount) * 100).toFixed(1).replace('.', ',');
    cleanupResult.textContent =
      'Smazáno ' + toDelete.length + ' (' + percent + ' %), uvolněno ~' + formatBytes(freedBytes) + '.';

    await renderGallery();
  } catch (e) {
    console.error(e);
    cleanupResult.textContent = 'Mazání se nepodařilo.';
  }
}

export async function enforceLimits() {
  try {
    const photos = await loadPhotos();
    if (!photos.length) return;

    const maxPhotos = getMaxPhotos();
    const maxBytes = getMaxBytes();

    let { bytes: totalBytes, count: totalCount } = computeTotals(photos);
    if (totalCount <= maxPhotos && totalBytes <= maxBytes) return;

    const sorted = photos.slice().sort((a, b) => a.createdAt - b.createdAt);

    let freedBytes = 0;
    let removedCount = 0;

    for (const photo of sorted) {
      if (totalCount <= maxPhotos && totalBytes <= maxBytes) break;
      const b = (photo.blob && photo.blob.size) || photo.size || 0;
      await deletePhoto(photo.id!);
      totalCount -= 1;
      totalBytes -= b;
      freedBytes += b;
      removedCount += 1;
    }

    if (removedCount > 0) {
      console.log(
        'Automaticky odstraněno ' +
          removedCount +
          ' snímků kvůli limitům (ušetřeno ~' +
          formatBytes(freedBytes) +
          ').'
      );
    }
  } catch (e) {
    console.error('enforceLimits failed', e);
  }
}

export async function updatePhotoHint() {
  try {
    const photos = await loadPhotos();
    updateGallerySummary(photos);
  } catch (e) {
    console.error(e);
  }
}

export function showGallery() {
  galleryCard.hidden = false;
  renderGallery();
}

export function hideGallery() {
  galleryCard.hidden = true;
}
