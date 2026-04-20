const { haversine, drivingMinutes } = require('./haversine');

const MY_TIMEZONE = 'Asia/Kuala_Lumpur';

const nowMY = () => {
  return new Date(new Date().toLocaleString('en-US', { timeZone: MY_TIMEZONE }));
};

const timeToDateMY = (timeStr, baseDate = null) => {
  const base = baseDate || nowMY();
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

const getDayMY = (date = null) => {
  const d = date || nowMY();
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return days[d.getDay()];
};

const calculateETA = (
  originLat, originLng,
  hospitalLat, hospitalLng,
  operationHours,
  bookingDate,
  currentQueueMinutes
) => {
  const distanceKm = haversine(originLat, originLng, hospitalLat, hospitalLng);
  const driveMinutes = drivingMinutes(distanceKm);

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

  // CRITICAL — Check if booking is for TODAY
  const now = nowMY();
  const todayStr = now.toISOString().split('T')[0];
  const bookDateStr = bookDate.toISOString().split('T')[0];
  const isToday = todayStr === bookDateStr;

  if (isToday) {
    // Clinic already closed
    if (now >= closeTime) {
      return { error: 'Clinic is already closed for today' };
    }
    // Use NOW as base if already past open time
    // Also check driving time fits within remaining hours
    const etaBase = now > openTime ? now : openTime;
    let eta = new Date(etaBase.getTime() + currentQueueMinutes * 60000);

    // Skip lunch
    if (lunchStart && lunchEnd && eta >= lunchStart && eta < lunchEnd) {
      eta = new Date(lunchEnd.getTime());
    }

    // ETA must be within closing time
    if (eta >= closeTime) {
      return { error: 'No available slots — clinic is full for today' };
    }

    // Patient must be able to drive and arrive before closing
    const arrivalTime = new Date(now.getTime() + driveMinutes * 60000);
    if (arrivalTime >= closeTime) {
      return { error: 'Not enough time to reach clinic before closing' };
    }

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
  }

  // Future date booking
  let eta = new Date(openTime.getTime() + currentQueueMinutes * 60000);

  // Skip lunch
  if (lunchStart && lunchEnd && eta >= lunchStart && eta < lunchEnd) {
    eta = new Date(lunchEnd.getTime());
  }

  if (eta >= closeTime) {
    return { error: 'No available slots — clinic is full for the day' };
  }

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