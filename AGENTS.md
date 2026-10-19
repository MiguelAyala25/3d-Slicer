# Agent Guidelines & Project Rules

## Git & Commit Conventions
- **Commit Messages**: All git commit messages MUST be written in English.
- Use conventional commit formatting: `<type>(<scope>): <short description in English>`
  - Examples:
    - `feat(formats): add support for 3MF and PLY mesh formats`
    - `fix(exporter): correct layer naming in DXF generation`
    - `test(validator): add test cases for supported 3D extensions`

## Architecture & Code Standards
- Keep calculations in millimeters (mm) and scale 1:1.
- Laser cutting export layers:
  - `CORTE` (Cut): Red (#FF0000), outer/inner slice contours and disc contours.
  - `GRABADO` (Engrave): Blue (#0000FF), alignment circles, disc trays, labels.
- Slicing and geometry calculations should remain clean and headless in `slicer.py` and `layout.py`.
