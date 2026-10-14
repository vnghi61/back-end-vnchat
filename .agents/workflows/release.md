---
description: Phát hành phiên bản (semver, CHANGELOG)
---

# Workflow: Release

1. Versioning theo [SemVer](https://semver.org): MAJOR khi phá API/event/client cũ, MINOR khi thêm tính năng, PATCH khi sửa lỗi.
2. `CHANGELOG.md`: chuyển mục `[Unreleased]` thành `[x.y.z] - YYYY-MM-DD`, nhóm Added / Changed / Fixed / Security / Breaking.
3. Cập nhật `"version"` trong `package.json` và `info.version` trong `api/openapi.yaml`.
4. Commit theo Conventional Commits: `chore(release): vX.Y.Z`; tag `vX.Y.Z`; push tag.
5. Merge vào `master` → CI xanh → Render deploy ([deploy.md](deploy.md)). `/health` hiện commit đang chạy.
6. Breaking: ghi cách nâng cấp client trong `docs/frontend-integration.md` §6 và phần Breaking của CHANGELOG.
