import { packForLink, unpackFromLink } from '../wishes/share';

// Lot 13: the link the owner sends to the relatives they share a place with. It travels after the « # »,
// never sent to the host, and holds what the guest's device needs to open the place: the Drive file,
// and the Google client of the owner (a relative creates none), which only signs in to this app.
// The same link serves every guest: only the people the owner added in Drive can open the file.

export interface Invitation {
  fileId: string;
  /** Name of the place. */
  place: string;
  /** Name of the owner on Google. */
  owner: string;
  clientId: string;
  clientSecret: string;
}

const VERSION = 1;

type Packed = { v: number; f: string; p: string; o: string; c: string; s: string };

export function encodeInvitation(invitation: Invitation): Promise<string> {
  const packed: Packed = {
    v: VERSION,
    f: invitation.fileId,
    p: invitation.place,
    o: invitation.owner,
    c: invitation.clientId,
    s: invitation.clientSecret,
  };
  return packForLink(packed);
}

const isText = (value: unknown): value is string => typeof value === 'string';

/** Undefined when the link is cut short or altered. */
export async function decodeInvitation(payload: string): Promise<Invitation | undefined> {
  try {
    const packed = (await unpackFromLink(payload)) as Partial<Packed> | null;
    if (packed?.v !== VERSION || ![packed.f, packed.p, packed.o, packed.c, packed.s].every(isText)) return undefined;
    const { f = '', p = '', o = '', c = '', s = '' } = packed;
    if (!f || !c || !s) return undefined;
    return { fileId: f, place: p, owner: o, clientId: c, clientSecret: s };
  } catch {
    return undefined;
  }
}
