# Clinic Progress Report

A web application for tracking dental student clinical progress.

## Documentation

- **[Project Overview & Architecture](./PROJECT.md)**: detailed setup, architecture, and deployment guide.
- **[Verification Walkthrough](./walkthrough.md)**: testing steps and feature validation.
- **[Database Schema](./database-context.md)**: Supabase schema and implementation details.
- **[Table Constraints](./table-order-and-constraints.md)**: reference for data integrity.

## Quick Start for Developers

1. **Install Dependencies**:

   ```bash
   npm install -g @google/clasp
   clasp login
   ```

2. **Deploy Code**:

   ```bash
   cd gas
   clasp push
   ```

3. **Configure Environment**:
   Set Script Properties in the Apps Script editor (see `PROJECT.md` for keys).

4. **Test**:
   - Use the **Head Deployment** (`/dev`) URL for testing.
   - Append `?page=admin` to access the Admin Console in dev mode.
