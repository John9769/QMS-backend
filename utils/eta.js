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
  // 1. Calculate distance and drive time
  const distanceKm = haversine(originLat, originLng, hospitalLat, hospitalLng);
  const driveMinutes = drivingMinutes(distanceKm);

  // 2. Check operation hours
  const bookDate = new Date(bookingDate);
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const dayStr = days[bookDate.getDay()];
  const dayHours = operationHours.find(h => h.day_of_week === dayStr);

  if (!dayHours || dayHours.is_closed) {
    return { error: 'Clinic is closed on this day' };
  }

  const openTime = timeToDateMY(dayHours.open_time, bookDate);
  const closeTime = timeToDateMY(dayHours.close_time, bookDate);

  // 3. Lunch buffer
  const lunchBufferStart = timeToDateMY('12:45', bookDate);
  const lunchBufferEnd = timeToDateMY('14:00', bookDate);

  const now = nowMY();
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: MY_TIMEZONE });
  const bookDateStr = bookDate.toLocaleDateString('en-CA', { timeZone: MY_TIMEZONE });
  const isToday = todayStr === bookDateStr;

  if (isToday) {
    if (now >= closeTime) {
      return { error: 'Clinic is already closed for today' };
    }

    // Patient physical arrival time from now
    const physicalArrival = new Date(now.getTime() + driveMinutes * 60000);

    // Cannot reach before closing
    if (physicalArrival >= closeTime) {
      return { error: 'Not enough time to reach the clinic before closing' };
    }

    // Slot base = latest of open time OR physical arrival time
    const slotBase = physicalArrival > openTime ? physicalArrival : openTime;

    // Add queue minutes
    let slot = new Date(slotBase.getTime() + currentQueueMinutes * 60000);

    // Push slot past lunch buffer
    if (slot >= lunchBufferStart && slot < lunchBufferEnd) {
      slot = new Date(lunchBufferEnd.getTime());
    }

    if (slot >= closeTime) {
      return { error: 'No available slots — clinic is full for today' };
    }

    let slotDeadline = new Date(slot.getTime() + 15 * 60000);
    if (slotDeadline >= lunchBufferStart && slotDeadline < lunchBufferEnd) {
      slotDeadline = new Date(lunchBufferEnd.getTime() + 15 * 60000);
    }

    return {
      distanceKm: Math.round(distanceKm * 100) / 100,
      driveMinutes,
      eta: slot,
      etaDeadline: slotDeadline,
      dayStr,
      openTime,
      closeTime
    };
  }

  // Future date — slot from open time + queue minutes
  // Drive time not needed since patient plans ahead
  let slot = new Date(openTime.getTime() + currentQueueMinutes * 60000);

  if (slot >= lunchBufferStart && slot < lunchBufferEnd) {
    slot = new Date(lunchBufferEnd.getTime());
  }

  if (slot >= closeTime) {
    return { error: 'No available slots — clinic is full for the day' };
  }

  const slotDeadline = new Date(slot.getTime() + 15 * 60000);

  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    driveMinutes,
    eta: slot,
    etaDeadline: slotDeadline,
    dayStr,
    openTime,
    closeTime
  };
};

module.exports = { nowMY, timeToDateMY, getDayMY, calculateETA };