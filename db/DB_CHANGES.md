# Database Changes & Additions Required

Generated: 2026-05-22
Status: Pending implementation

---

## Summary

The frontend `AddProjectWizard` and `EditProjectWizard` collect ~30 fields across 5 sections,
but the backend `Project` table only persists 12 of them. The rest are silently dropped.
Additionally, CP bookmarks are stored in `localStorage` only — no DB table exists.

---

## 1. `Project` Table — Missing Columns

Add the following columns to the `Project` model in `prisma/schema.prisma`.

### 1a. Location fields

| Column | Type | Notes |
|---|---|---|
| `locality` | `String?` | Neighbourhood / micro-market |
| `pincode` | `String?` | 6-digit PIN code |
| `landmark` | `String?` | Nearby landmark text |
| `googleMapsLink` | `String?` | Full Google Maps share URL |

**SQL (run manually or via migration):**
```sql
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "locality"       TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pincode"        TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "landmark"       TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "googleMapsLink" TEXT;
```

**Prisma schema addition (inside `model Project`):**
```prisma
locality        String?
pincode         String?
landmark        String?
googleMapsLink  String?
```

---

### 1b. Project identity / structure fields

| Column | Type | Notes |
|---|---|---|
| `towers` | `Int?` | Number of towers |
| `floorsPerTower` | `Int?` | Floors per tower |
| `projectType` | `String?` | Apartment / Villa / Plot / Commercial / Mixed Use |
| `configurations` | `String[]` | BHK types e.g. `["2BHK","3BHK"]` |

**SQL:**
```sql
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "towers"         INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "floorsPerTower" INTEGER;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "projectType"    TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "configurations" TEXT[] DEFAULT '{}';
```

**Prisma schema addition:**
```prisma
towers          Int?
floorsPerTower  Int?
projectType     String?
configurations  String[]
```

---

### 1c. Pricing fields

| Column | Type | Notes |
|---|---|---|
| `pricePerSqftMin` | `Float?` | Min price per sq ft |
| `pricePerSqftMax` | `Float?` | Max price per sq ft |
| `maintenanceCharges` | `Float?` | Monthly maintenance (₹/sqft) |
| `floorRiseCharges` | `Float?` | Per-floor price increment |

**SQL:**
```sql
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pricePerSqftMin"     DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "pricePerSqftMax"     DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "maintenanceCharges"  DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "floorRiseCharges"    DOUBLE PRECISION;
```

**Prisma schema addition:**
```prisma
pricePerSqftMin     Float?
pricePerSqftMax     Float?
maintenanceCharges  Float?
floorRiseCharges    Float?
```

---

### 1d. Commission fields

| Column | Type | Notes |
|---|---|---|
| `commissionStructure` | `String?` | `"flat"` or `"slab"` |
| `flatCommissionPct` | `Float?` | Used when structure is `flat` |
| `commissionSlabs` | `Json?` | JSON array of slab rows when structure is `slab` |
| `cpIncentive` | `String?` | Free-text incentive description for CPs |

**SQL:**
```sql
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "commissionStructure" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "flatCommissionPct"   DOUBLE PRECISION;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "commissionSlabs"     JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "cpIncentive"         TEXT;
```

`commissionSlabs` JSON shape (when `commissionStructure = 'slab'`):
```json
[
  { "minUnits": 1,  "maxUnits": 10,  "percent": 2.0 },
  { "minUnits": 11, "maxUnits": 30,  "percent": 2.5 },
  { "minUnits": 31, "maxUnits": 100, "percent": 3.0 }
]
```

**Prisma schema addition:**
```prisma
commissionStructure String?
flatCommissionPct   Float?
commissionSlabs     Json?
cpIncentive         String?
```

---

### 1e. Amenities & highlights (array fields)

| Column | Type | Notes |
|---|---|---|
| `amenities` | `String[]` | e.g. `["Swimming Pool","Gym","Clubhouse"]` |
| `nearbyHighlights` | `String[]` | e.g. `["Metro Station","IT Park"]` |

**SQL:**
```sql
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "amenities"       TEXT[] DEFAULT '{}';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "nearbyHighlights" TEXT[] DEFAULT '{}';
```

**Prisma schema addition:**
```prisma
amenities         String[]
nearbyHighlights  String[]
```

---

## 2. New Table — `UnitConfig`

The wizard collects per-BHK unit details that currently have no table.

| Column | Type | Notes |
|---|---|---|
| `id` | `Int` PK | Auto-increment |
| `projectId` | `Int` FK | → `Project.id` |
| `bhkType` | `String` | e.g. `"2BHK"`, `"3BHK"` |
| `carpetArea` | `Float?` | sq ft |
| `superBuiltUp` | `Float?` | sq ft |
| `floors` | `String?` | Floor range e.g. `"1-5"` |
| `count` | `Int?` | Number of units of this type |
| `basePrice` | `Float?` | Base price in ₹ |
| `status` | `String` | `"Available"` / `"Sold Out"` / `"Blocked"` |
| `createdAt` | `DateTime` | Auto |

**SQL:**
```sql
CREATE TABLE IF NOT EXISTS "UnitConfig" (
    "id"          SERIAL NOT NULL,
    "projectId"   INTEGER NOT NULL,
    "bhkType"     TEXT NOT NULL,
    "carpetArea"  DOUBLE PRECISION,
    "superBuiltUp" DOUBLE PRECISION,
    "floors"      TEXT,
    "count"       INTEGER,
    "basePrice"   DOUBLE PRECISION,
    "status"      TEXT NOT NULL DEFAULT 'Available',
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitConfig_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "UnitConfig" ADD CONSTRAINT "UnitConfig_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**Prisma schema (new model):**
```prisma
model UnitConfig {
  id           Int      @id @default(autoincrement())
  projectId    Int
  project      Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  bhkType      String
  carpetArea   Float?
  superBuiltUp Float?
  floors       String?
  count        Int?
  basePrice    Float?
  status       String   @default("Available")
  createdAt    DateTime @default(now())
}
```

Also add the back-relation on `Project`:
```prisma
unitConfigs  UnitConfig[]
```

---

## 3. New Table — `CPBookmark`

CP bookmarks are currently stored in browser `localStorage` under key `dealio_cp_bookmarks`.
They are lost when the browser is cleared or the user switches devices.

| Column | Type | Notes |
|---|---|---|
| `id` | `Int` PK | Auto-increment |
| `cpId` | `Int` FK | → `ChannelPartner.id` |
| `projectId` | `Int` FK | → `Project.id` |
| `createdAt` | `DateTime` | Auto |

Unique constraint on `(cpId, projectId)` to prevent duplicates.

**SQL:**
```sql
CREATE TABLE IF NOT EXISTS "CPBookmark" (
    "id"        SERIAL NOT NULL,
    "cpId"      INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CPBookmark_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CPBookmark_unique" UNIQUE ("cpId", "projectId")
);

ALTER TABLE "CPBookmark" ADD CONSTRAINT "CPBookmark_cpId_fkey"
    FOREIGN KEY ("cpId") REFERENCES "ChannelPartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CPBookmark" ADD CONSTRAINT "CPBookmark_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**Prisma schema (new model):**
```prisma
model CPBookmark {
  id         Int            @id @default(autoincrement())
  cpId       Int
  cp         ChannelPartner @relation(fields: [cpId], references: [id], onDelete: Cascade)
  projectId  Int
  project    Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt  DateTime       @default(now())

  @@unique([cpId, projectId])
}
```

Also add back-relations:
```prisma
// on ChannelPartner model
bookmarks    CPBookmark[]

// on Project model
cpBookmarks  CPBookmark[]
```

---

## 4. Backend API Changes Required

After schema changes, the following controller / route updates are needed:

### `builderController.ts` — `createProject`
Wire all new fields from `req.body` into the `prisma.project.create` call:
- `locality`, `pincode`, `landmark`, `googleMapsLink`
- `towers`, `floorsPerTower`, `projectType`
- `configurations`, `amenities`, `nearbyHighlights`
- `pricePerSqftMin/Max`, `maintenanceCharges`, `floorRiseCharges`
- `commissionStructure`, `flatCommissionPct`, `commissionSlabs`, `cpIncentive`

Then insert `UnitConfig` rows in the same request:
```ts
await prisma.unitConfig.createMany({ data: projectData.unitConfigs.map(u => ({ ...u, projectId: newProject.id })) });
```

### `builderController.ts` — `updateProject`
Same fields need to be handled in the `updateProject` patch.

### New CP Bookmark routes (add to `cpRoutes.ts`)
```
POST   /cp/:cpUserId/bookmarks/:projectId   → toggle bookmark (create or delete)
GET    /cp/:cpUserId/bookmarks              → list bookmarked projects
```

---

## 5. Complete Column Checklist

| Field | Current Status | Fix |
|---|---|---|
| `address` | ✅ saved | — |
| `city` | ✅ saved | — |
| `reraNumber` | ✅ saved | — |
| `reraExpiry` | ✅ saved | — |
| `priceFrom` / `priceTo` | ✅ saved | — |
| `commissionValue` | ✅ saved | — |
| `featured` | ✅ saved | — |
| `closingSoon` | ✅ saved | — |
| `imageUrl` | ✅ saved | — |
| `videoUrl` | ✅ saved | — |
| `possessionDate` | ✅ saved | — |
| `totalUnits` | ✅ saved | — |
| `locality` | ❌ dropped | Add column — Section 1a |
| `pincode` | ❌ dropped | Add column — Section 1a |
| `landmark` | ❌ dropped | Add column — Section 1a |
| `googleMapsLink` | ❌ dropped | Add column — Section 1a |
| `towers` | ❌ dropped | Add column — Section 1b |
| `floorsPerTower` | ❌ dropped | Add column — Section 1b |
| `projectType` | ❌ dropped | Add column — Section 1b |
| `configurations` | ❌ dropped | Add column — Section 1b |
| `pricePerSqftMin` | ❌ dropped | Add column — Section 1c |
| `pricePerSqftMax` | ❌ dropped | Add column — Section 1c |
| `maintenanceCharges` | ❌ dropped | Add column — Section 1c |
| `floorRiseCharges` | ❌ dropped | Add column — Section 1c |
| `commissionStructure` | ❌ dropped | Add column — Section 1d |
| `flatCommissionPct` | ❌ dropped | Add column — Section 1d |
| `commissionSlabs` | ❌ dropped | Add column — Section 1d |
| `cpIncentive` | ❌ dropped | Add column — Section 1d |
| `amenities` | ❌ dropped | Add column — Section 1e |
| `nearbyHighlights` | ❌ dropped | Add column — Section 1e |
| Unit configs (BHK details) | ❌ no table | New `UnitConfig` table — Section 2 |
| CP bookmarks | ❌ localStorage only | New `CPBookmark` table — Section 3 |