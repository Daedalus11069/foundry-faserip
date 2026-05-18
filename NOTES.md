# FASERIP System Development Notes

## TODO

- [ ] Add more detailed Universal Table implementation (column shifts, etc.)
- [ ] Implement damage calculation system
- [ ] Add equipment items with material ranks
- [ ] Create compendium packs for common powers and talents
- [ ] Add combat tracking features
- [ ] Implement popularity and resources tracking
- [ ] Add auto-sync feature for Charman characters
- [ ] Create NPC-specific sheet with simplified interface
- [ ] Add support for teams and team resources
- [ ] Implement karma spending system

## API Endpoints to Create in Charman

The following endpoints should be added to your Charman API for full integration:

```php
// Get single character
GET /api/characters/{username}/{characterName}

// List all characters for a user
GET /api/characters/{username}

// Optional: Real-time updates webhook
POST /api/webhooks/character-updated
```

## Future Enhancements

1. **Item System**: Create Item types for powers, talents, equipment, and contacts as proper Foundry items instead of embedded data
2. **Combat Tracker**: Custom combat tracker with column shifts and karma tracking
3. **Drag & Drop**: Support dragging powers/talents between characters
4. **Templates**: Save character templates for common archetypes
5. **Automation**: Automatic calculation of health, damage, and effects
6. **Macros**: Pre-built macros for common actions

## Known Issues

- Charman API URL is hardcoded in faserip.ts - should be configurable in system settings
- No validation for rank values on import
- No conflict resolution for character updates (last write wins)

## Testing Checklist

- [ ] Create PC actor
- [ ] Edit all seven attributes
- [ ] Roll each attribute
- [ ] Roll initiative
- [ ] Add/remove powers
- [ ] Add/remove talents
- [ ] Switch between forms (if multiple)
- [ ] Import from Charman
- [ ] Update health and karma
- [ ] Edit biography
- [ ] Save and reload character

## Performance Notes

- Vue reactivity automatically syncs changes to Foundry
- Large arrays (100+ powers) may cause slowdown - consider pagination
- Image uploads should use Foundry's FilePicker
