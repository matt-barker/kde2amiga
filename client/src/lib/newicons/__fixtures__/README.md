# Vendored NewIcons fixtures

`Apps.info` and `0016.info` are real, in-the-wild NewIcons `.info` files, copied verbatim
from the `test-icons/Newicons/` directory of:

- **steffest/Amiga-Icon-converter** — https://github.com/steffest/Amiga-Icon-converter
- Licence: MIT, Copyright (c) 2019-2023 Steffest — see `LICENSE.Amiga-Icon-converter`
  (a verbatim copy of that repository's `LICENSE`).

They are unmodified. SHA-256:

```
ed19a703d5cc4e6c194ba38a4ba0cd5bc8844f70b4b41cb2e829eda2f35bfb77  Apps.info
1ad151154f72d455f7efcbd6cadc27eb0dac3b40751edb47358ce6bb78f67a4a  0016.info
```

## Why they are here

They are the external oracle for our NewIcons encoder. Everything we know about the
on-disk format was previously inferred from our own writer, so our decoder and our tests
shared the writer's bugs and stayed green over unreadable output. These two files are
ground truth produced by real Amiga software, and `newIconsFixtures.test.ts` asserts our
decoder reads them to their known values:

| File        | IM1 header bytes    | decoded                                  |
|-------------|---------------------|------------------------------------------|
| `Apps.info` | `[66,69,73,33,41]` = `"BEI!)"` | transparent, 36 x 40, 8 colours, 3 bits/pixel |
| `0016.info` | `[66,75,75,33,65]` = `"BKK!A"` | transparent, 42 x 42, 32 colours, 5 bits/pixel |

Two format facts these files pin down, both of which our encoder originally got wrong:

1. **The five header characters are raw literal bytes.** They are not 7-bit encoded.
   `Apps.info` byte 0 of its IM1 payload is `66` (`'B'`), not `98` (`'b'`).
2. **Each pixel line is an independent bit stream.** `0016.info`'s six IM1 pixel lines
   leave remainders of 3, 1, 2, 1, 0, 0 bits; flooring per line sums to exactly
   42 x 42 = 1764 pixels, whereas concatenating the lines first yields 1765 and
   desynchronises the image.

`Apps.info` additionally exercises the `byte > 208` RLE branch of the reference decoder
in its IM1 palette line (27 encoded characters expand to 224 bits, i.e. 32 seven-bit
groups), which is why our decoder implements that branch even though our encoder only
ever emits literals.
