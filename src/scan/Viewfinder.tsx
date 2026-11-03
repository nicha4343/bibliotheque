import type { ComponentChildren, RefObject } from 'preact';
import { TorchIcon } from '../components/icons';
import { fr } from '../textes/fr';
import type { CameraState } from './useCamera';

export type FlashKind = 'ok' | 'warn' | 'info';

/** Status banner above the aiming frame: what the last code read meant. */
export interface Flash {
  kind: FlashKind;
  text: string;
  /** Second line, kept whole: where to put a book given back, the reminder of a loan. */
  detail?: string;
}

export interface ViewfinderRefs {
  video: RefObject<HTMLVideoElement | null>;
  view: RefObject<HTMLDivElement | null>;
  aim: RefObject<HTMLDivElement | null>;
}

interface ViewfinderProps {
  refs: ViewfinderRefs;
  camera: CameraState;
  detectorAvailable: boolean;
  flash: Flash;
  hint: string;
  /** Left of the top bar: the place. */
  place: ComponentChildren;
  /** Right of the top bar, after the torch. */
  actions?: ComponentChildren;
  counters: ComponentChildren;
  /** Photograph of a book without a barcode: a frame of the shape of a cover, no sweeping line. */
  cover?: boolean;
}

/** Camera picture, aiming frame, status banner and camera errors: screen 1 and the shelf check. */
export function Viewfinder({ refs, camera, detectorAvailable, flash, hint, place, actions, counters, cover = false }: ViewfinderProps) {
  const cameraMessage =
    camera.status === 'error'
      ? {
          denied: fr.scan.cameraDenied,
          notFound: fr.scan.cameraNotFound,
          unsupported: fr.scan.cameraUnsupported,
          failed: fr.scan.cameraFailed,
        }[camera.error ?? 'failed']
      : !detectorAvailable
        ? fr.scan.detectorFailed
        : undefined;

  return (
    <div class="scan__view" ref={refs.view}>
      <video class="scan__video" ref={refs.video} playsInline muted autoPlay aria-hidden="true" />

      <div class="scan__top">
        {place}
        <div class="scan__top-actions">
          {camera.torchAvailable && (
            <button
              type="button"
              class="scan__round-button"
              aria-label={camera.torchOn ? fr.scan.torchOff : fr.scan.torchOn}
              aria-pressed={camera.torchOn}
              onClick={camera.toggleTorch}
            >
              <TorchIcon size={20} />
            </button>
          )}
          {actions}
        </div>
      </div>

      <div class="scan__counters">{counters}</div>

      <div class="scan__center">
        <p class={`scan__flash scan__flash--${flash.kind}`} role="status">
          <span class="scan__flash-dot" aria-hidden="true" />
          <span class="scan__flash-body">
            <span class="scan__flash-text">{flash.text}</span>
            {flash.detail && <span class="scan__flash-detail">{flash.detail}</span>}
          </span>
        </p>
        <div class={cover ? 'scan__aim scan__aim--cover' : 'scan__aim'} ref={refs.aim} aria-hidden="true">
          <span class="scan__corner scan__corner--tl" />
          <span class="scan__corner scan__corner--tr" />
          <span class="scan__corner scan__corner--bl" />
          <span class="scan__corner scan__corner--br" />
          {camera.status === 'ready' && !cover && <span class="scan__sweep" />}
        </div>
        {cameraMessage ? (
          <div class="scan__message">
            <p>{cameraMessage}</p>
            {camera.status === 'error' && (
              <button type="button" class="button button--light" onClick={camera.retry}>
                {fr.scan.retry}
              </button>
            )}
          </div>
        ) : (
          <p class="scan__hint">{camera.status === 'starting' ? fr.scan.cameraStarting : hint}</p>
        )}
      </div>
    </div>
  );
}
