import { setGoogleBooksPacing } from './metadata/search';

// Unit tests do without the pauses that Google Books needs between requests and after a refusal.
setGoogleBooksPacing({ spacingMs: 0, retryDelaysMs: [0, 0] });
