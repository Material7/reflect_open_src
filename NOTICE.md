# Third-Party Software Notices

Reflect is distributed under the MIT License ([LICENSE](LICENSE)).

## Bundled Source Code

The components under `frontend/src/app/components/ui/` (`popover.tsx`, `tooltip.tsx`,
`utils.ts`) are based on [shadcn/ui](https://github.com/shadcn-ui/ui).

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The artwork in `frontend/public/favicon.svg` is based on the `layout-dashboard`
icon from [lucide](https://github.com/lucide-icons/lucide).

```
ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
Feather (MIT). All other copyright (c) for Lucide are held by Lucide
Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Dependencies

The source code of the dependencies listed below is not included in this
repository. It is fetched from npm and Maven Central at build time. No package
under a strong copyleft license such as GPL, AGPL, or SSPL is included.

### Frontend

| Category | Package | License |
|---------|-----------|----------|
| Core | react, react-dom | MIT |
| Charts | recharts | MIT |
| Icons | lucide-react | ISC |
| Dates | date-fns, react-day-picker | MIT |
| Notifications | sonner | MIT |
| UI components | @radix-ui/react-popover, @radix-ui/react-tooltip | MIT |
| Utilities | clsx, tailwind-merge, tw-animate-css | MIT |
| Build tools | vite, @vitejs/plugin-react, tailwindcss, @tailwindcss/vite | MIT |
| Build tools | typescript | Apache 2.0 |
| Build tools (transitive) | lightningcss | MPL-2.0 — build time only |
| Build tools (transitive) | caniuse-lite | CC-BY-4.0 — build time only |

### Backend

| Package | License |
|-----------|----------|
| Spring Boot / Security / Data JPA / Validation | Apache 2.0 |
| jjwt (jjwt-api, jjwt-impl, jjwt-jackson) | Apache 2.0 |
| PostgreSQL JDBC Driver | BSD-2-Clause |
| Lombok | MIT |
| Hibernate ORM 6.6 | LGPL-2.1 or later |

> Last verified: 2026-08-22 (against `frontend/package.json` and `backend/build.gradle`)

### Licenses That Require Attention

| Package | License | Handling |
|---|---|---|
| Hibernate ORM 6.6 | LGPL-2.1 or later | See below |
| lightningcss (transitive dependency of tailwindcss) | MPL-2.0 | Build time only; not part of the distributed artifact |
| caniuse-lite (transitive dependency of browserslist) | CC-BY-4.0 | Build time only; not part of the distributed artifact |

**About Hibernate ORM (LGPL-2.1 or later)**

Hibernate ORM is used in the standard way through Spring Data JPA, and the
library itself is not modified. Used this way, it does not stand in the way of
distributing this software under the MIT License.

If you redistribute Hibernate **bundled with** this software, however — which is
the case when you distribute a Spring Boot executable JAR or a Docker image —
then LGPL-2.1 requires you to keep recipients able to replace Hibernate with a
different version, and to include the text of the LGPL along with this notice.
Building from source and running the result within your own organization, which
is the ordinary way to use this software, does not trigger that obligation.

Note that Hibernate ORM switched to Apache-2.0 as of 7.0, but the Spring Boot 3.5
line used by this project resolves to 6.6.

## External Services

`https://api.national-holidays.jp/` is the default source for Japanese public
holiday information. This URL can be changed or disabled from the application's
settings screen. Please review the provider's terms of use before relying on it.
