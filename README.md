# verdaccio-pg-storage

📦 PostgreSQL storage plugin for Verdaccio

[![verdaccio (latest)](https://img.shields.io/npm/v/verdaccio-pg-storage/latest.svg)](https://www.npmjs.com/package/verdaccio-pg-storage)
![MIT](https://img.shields.io/github/license/mashape/apistatus.svg)
[![node](https://img.shields.io/node/v/verdaccio-pg-storage/latest.svg)](https://www.npmjs.com/package/verdaccio-pg-storage)

---

## Basic Requirements

- PostgreSQL >= 9.3
- Verdaccio Server >= 4.0

```
npm install -g verdaccio
```

## Usage

```
npm install verdaccio-pg-storage
```

In your verdaccio config, configure

```yaml
store:
  pg-storage:
    url: your-pg-connection-url # OR you can specify using environment POSTGRES_URL.
```

## TODO

- [ ] Add Tests
- [x] Add Docs
- [x] Optimize File Uploading
- [x] Make Migration
- [x] Reorganize Log Messages
- [ ] Build With CI
