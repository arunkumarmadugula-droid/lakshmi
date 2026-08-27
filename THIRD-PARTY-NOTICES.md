# Pinned browser parsers

Vidya stores these parser builds locally so opening a PDF or DOCX does not load
executable parser code from a third-party CDN at runtime.

| File | Version/source | SHA-256 |
|---|---|---|
| `vendor/pdf.min.js` | PDF.js 3.11.174 via cdnjs | `5B5799E6F8C680663207AC5B42EE14EED2A406FA7AF48F50C154F0C0B1566946` |
| `vendor/pdf.worker.min.js` | PDF.js 3.11.174 worker via cdnjs | `FEABDF309770ED24BBA31A5467836CDC8CF639C705AF27D52B585B041BB8527B` |
| `vendor/mammoth.browser.min.js` | Mammoth 1.6.0 via cdnjs | `596EF52239E52D8EE3CEE10B2EE4A72596ABF900D0E4F468593F956E9F1809B0` |

Upgrading a parser is a code change: review the upstream release, replace both
PDF.js files together, update the service-worker cache name, recompute hashes,
then test PDF/DOCX ingestion before deployment.
