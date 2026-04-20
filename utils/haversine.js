// Haversine formula — calculates distance between 2 GPS points in KM
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371; // Earth radius in KM
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in KM
};

// Calculate driving minutes at given speed (default 80km/h)
const drivingMinutes = (distanceKm, speedKmh = 80) => {
  return Math.ceil((distanceKm / speedKmh) * 60);
};

module.exports = { haversine, drivingMinutes };