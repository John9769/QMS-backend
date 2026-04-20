const { haversine, drivingMinutes } = require('./haversine');

// Malaysia timezone
const MY_TIMEZONE = 'Asia/Kuala_Lumpur';

// Get current Malaysia time
const nowMY = () => {
  return new Date(new Date().toLocaleString('en-US', { timeZone: MY_TIMEZONE }));
};

// Convert time string "08:00" to today's Date object in MY time
const timeToDateMY = (timeStr, baseDate = null) => {
  const base = baseDate || nowMY();
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

// Get day of week string for Malaysia time
const getDayMY = (date = null) => {
  const d = date || nowMY();
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return days[d.getDay()];
};

// Calculate ETA for patient booking
const calculateETA = (
  originLat, originLng,
  hospitalLat, hospitalLng,
  operationHours,
  bookingDate,
  currentQueueMinutes // total minutes already booked ahead
) => {
  // Distance and drive time
  const distanceKm = haversine(originLat, originLng, hospitalLat, hospitalLng);
  const driveMinutes = drivingMinutes(distanceKm);

  // Get operation hours for booking date day
  const bookDate = new Date(bookingDate);
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const dayStr = days[bookDate.getDay()];
  const dayHours = operationHours.find(h => h.day_of_week === dayStr);

  if (!dayHours || dayHours.is_closed) {
    return { error: 'Clinic is closed on this day' };
  }

  const openTime = timeToDateMY(dayHours.open_time, bookDate);
  const closeTime = timeToDateMY(dayHours.close_time, bookDate);
  const lunchStart = dayHours.lunch_start ? timeToDateMY(dayHours.lunch_start, bookDate) : null;
  const lunchEnd = dayHours.lunch_end ? timeToDateMY(dayHours.lunch_end, bookDate) : null;

  // ETA = open time + queue minutes ahead
  let eta = new Date(openTime.getTime() + currentQueueMinutes * 60000);

  // Skip lunch break
  if (lunchStart && lunchEnd && eta >= lunchStart && eta < lunchEnd) {
    eta = new Date(lunchEnd.getTime());
  }

  // Check if ETA is within operation hours
  if (eta >= closeTime) {
    return { error: 'No available slots — clinic is full for the day' };
  }

  // ETA deadline = ETA + 15 minutes
  const etaDeadline = new Date(eta.getTime() + 15 * 60000);

  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    driveMinutes,
    eta,
    etaDeadline,
    dayStr,
    openTime,
    closeTime
  };
};

module.exports = { nowMY, timeToDateMY, getDayMY, calculateETA };