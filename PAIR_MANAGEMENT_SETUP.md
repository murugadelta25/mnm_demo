# Pair Management System - Setup & Migration Guide

## Overview
This implementation adds a comprehensive pair management system to the TITAN OEE system:
- Pairs are now first-class database entities (not hardcoded 1-8)
- Machines reference pairs via foreign key
- Full CRUD operations on pairs with validation
- Dynamic pair dropdown in machine forms
- Pair management UI with machine mapping visualization

## Database Changes

### Files Modified/Created

#### Backend
- **models.py**: Added `Pair` model, updated `Machine` model to use `pair_id` FK
- **routers/pairs.py**: NEW - Complete CRUD endpoints for pair management
- **routers/machines.py**: Updated to reference `pair_id` instead of `pair_no`
- **main.py**: Registered pairs router

#### Frontend
- **pages/MachineConfig.jsx**: Completely rewritten with tabs (Pair Management + Fleet)

## Migration Steps (One-Time Setup)

### 1. Run the migration script
```bash
cd backend
python migrate_pairs.py
```

This script will:
- Create the `pairs` table
- Add `pair_id` column to `machines` table
- Migrate existing `pair_no` values to pairs
- Create pairs for pair numbers 1-8 (or however many exist)

### 2. Restart the backend service
```bash
# Stop the running backend
# Then restart it
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 3. Test in the UI
- Navigate to Machine Configuration
- You should see two tabs: "Pair Management" and "Machine Fleet"
- Pair Management shows all defined pairs with machine counts
- Machine Fleet shows all machines with a dynamic pair dropdown

## API Endpoints

### Pair Management
- `GET /api/pairs/` - List all pairs with machine count
- `POST /api/pairs/` - Create new pair
- `PUT /api/pairs/{pair_id}` - Update pair display name
- `DELETE /api/pairs/{pair_id}` - Delete pair (must have no machines)
- `GET /api/pairs/{pair_id}/machines` - Get machines for a pair

### Machine Management (Updated)
- `GET /api/machines/` - List all machines (includes pair_name)
- `POST /api/machines/` - Create machine (now uses pair_id)
- `PUT /api/machines/{machine_id}` - Update machine
- `DELETE /api/machines/{machine_id}` - Delete machine

## Key Features

### Pair Management Tab
✅ Create new pairs with name (unique) and display name
✅ Rename pairs (update display name only - name is immutable)
✅ Delete pairs (prevents if machines are assigned)
✅ Expandable pairs showing all assigned machines
✅ Edit/delete individual machines from pair view
✅ Shows machine count per pair

### Machine Fleet Tab
✅ Machines now show their pair assignment
✅ Dynamic pair dropdown (populated from pairs table)
✅ Add/edit/delete machines with full form
✅ Upload machine images
✅ All previous functionality preserved

## Validation & Error Handling

- Cannot create duplicate pair names
- Cannot delete pair with machines assigned (shows error message)
- Cannot create machine without selecting a valid pair
- Pair names are immutable after creation (prevents data consistency issues)
- Comprehensive error messages displayed in UI

## Backward Compatibility

- Old `pair_no` column retained in machines table for backward compatibility
- Existing OEE data and production plans continue to work
- Migration creates pairs for all existing pair_no values

## Testing Checklist

- [ ] Run migration script successfully
- [ ] Backend starts without errors
- [ ] Pair Management tab loads and shows pairs
- [ ] Create new pair
- [ ] Edit pair display name
- [ ] Try to delete pair with machines (should error)
- [ ] Create new machine with dynamic pair selection
- [ ] Edit machine and change its pair
- [ ] Fleet tab shows correct pair names
- [ ] All CRUD operations maintain data consistency
