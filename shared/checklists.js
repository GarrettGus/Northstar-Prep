// Fixed catalog of seasonal preparedness checklists. Items are not user-editable; a household's
// progress against them is tracked separately as checked rows keyed by `${season}__${item.id}`.
export const checklistCatalog = [
  {
    season: 'winter', label: 'Winter Readiness',
    items: [
      { id: 'insulate-pipes', text: 'Insulate exposed pipes and outdoor faucets' },
      { id: 'test-heat-source', text: 'Test backup heat source (generator, wood stove, propane heater)' },
      { id: 'vehicle-winter-kit', text: 'Restock vehicle winter emergency kit (blankets, sand, flares)' },
      { id: 'clear-gutters', text: 'Clear gutters and check the roof for ice-dam risk' },
      { id: 'stock-de-icer', text: 'Stock rock salt / ice melt and a snow shovel' },
    ],
  },
  {
    season: 'summer', label: 'Summer Readiness',
    items: [
      { id: 'service-cooling', text: 'Service air conditioning or stock backup fans' },
      { id: 'refresh-water', text: 'Refresh stored drinking water for heat-driven consumption' },
      { id: 'heat-supplies', text: 'Check cooling towels, electrolyte packets and sunscreen supply' },
      { id: 'test-smoke-detectors', text: 'Test smoke detectors ahead of wildfire/AC season' },
      { id: 'trim-vegetation', text: 'Trim dry vegetation away from the house' },
    ],
  },
  {
    season: 'severe_weather', label: 'Severe Weather',
    items: [
      { id: 'test-weather-radio', text: 'Test the NOAA weather radio and its backup batteries' },
      { id: 'review-shelter-spot', text: 'Review the family shelter spot and drill the route' },
      { id: 'secure-outdoor-items', text: 'Identify outdoor items to secure before a storm' },
      { id: 'check-sump-pump', text: 'Check the sump pump and its backup power' },
      { id: 'charge-power-banks', text: 'Charge power banks and backup batteries' },
    ],
  },
  {
    season: 'evacuation', label: 'Evacuation Readiness',
    items: [
      { id: 'pack-go-bags', text: 'Pack or refresh a go-bag for each family member' },
      { id: 'copy-documents', text: 'Store copies of key documents (ID, insurance, medical) somewhere accessible' },
      { id: 'confirm-meeting-points', text: 'Confirm the primary and secondary meeting points are current' },
      { id: 'fuel-vehicle', text: 'Keep the vehicle fuel tank at least half full' },
      { id: 'confirm-out-of-area-contact', text: 'Confirm the out-of-area emergency contact with the family' },
    ],
  },
];
