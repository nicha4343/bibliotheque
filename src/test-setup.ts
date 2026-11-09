import { setSourcePacing } from './metadata/search';

// Unit tests do without the pauses between Google Books requests and after a refusal of a source.
setSourcePacing({ spacingMs: 0, retryDelaysMs: [0, 0] });
