import { pool } from '../db/client.js';
import { DomainError } from '../errors/domain-error.js';

export interface ReserveInput {
  showId: string;
  userId: string;
  seats: string[];
}

export async function reserveSeats(input: ReserveInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const showResult = await client.query<{ price_paise: string; per_user_limit: number }>(
      'SELECT price_paise, per_user_limit FROM shows WHERE id = $1',
      [input.showId],
    );
    const show = showResult.rows[0];
    if (!show) throw new DomainError('SHOW_NOT_FOUND', 404, 'Show not found');

    // One row per (show,user) is the serialization point for concurrent limit checks.
    await client.query(
      `INSERT INTO user_show_inventory(show_id, user_id, active_seat_count)
       VALUES ($1, $2, 0)
       ON CONFLICT (show_id, user_id) DO NOTHING`,
      [input.showId, input.userId],
    );

    const inventoryResult = await client.query<{ active_seat_count: number }>(
      `SELECT active_seat_count
       FROM user_show_inventory
       WHERE show_id = $1 AND user_id = $2
       FOR UPDATE`,
      [input.showId, input.userId],
    );
    const activeSeatCount = inventoryResult.rows[0]?.active_seat_count ?? 0;

    if (activeSeatCount + input.seats.length > show.per_user_limit) {
      throw new DomainError('PER_USER_LIMIT_EXCEEDED', 409, 'Per-user seat limit exceeded');
    }

    // Deterministic ordering keeps overlapping multi-seat transactions from locking rows in opposite orders.
    const requestedSeats = [...input.seats].sort();
    const seatResult = await client.query<{ id: string; seat_number: string; status: 'available' | 'confirmed' }>(
      `SELECT id, seat_number, status
       FROM seats
       WHERE show_id = $1 AND seat_number = ANY($2::text[])
       ORDER BY seat_number
       FOR UPDATE`,
      [input.showId, requestedSeats],
    );

    if (seatResult.rows.length !== requestedSeats.length) {
      throw new DomainError('SEAT_NOT_FOUND', 404, 'One or more requested seats do not exist');
    }
    if (seatResult.rows.some((seat) => seat.status !== 'available')) {
      throw new DomainError('SEAT_TAKEN', 409, 'One or more requested seats are already reserved');
    }

    const amountPaise = Number(show.price_paise) * requestedSeats.length;
    const reservationResult = await client.query<{ id: string; created_at: Date }>(
      `INSERT INTO reservations(show_id, user_id, amount_paise, status)
       VALUES ($1, $2, $3, 'confirmed')
       RETURNING id, created_at`,
      [input.showId, input.userId, amountPaise],
    );
    const reservation = reservationResult.rows[0];
    if (!reservation) throw new Error('Reservation insert returned no row');

    const seatIds = seatResult.rows.map((seat) => seat.id);
    await client.query(
      `INSERT INTO reservation_seats(reservation_id, seat_id)
       SELECT $1, unnest($2::uuid[])`,
      [reservation.id, seatIds],
    );
    await client.query(
      `UPDATE seats
       SET status = 'confirmed', reservation_id = $1, updated_at = now()
       WHERE id = ANY($2::uuid[])`,
      [reservation.id, seatIds],
    );
    await client.query(
      `UPDATE user_show_inventory
       SET active_seat_count = active_seat_count + $3, updated_at = now()
       WHERE show_id = $1 AND user_id = $2`,
      [input.showId, input.userId, requestedSeats.length],
    );

    await client.query('COMMIT');
    return {
      reservation_id: reservation.id,
      show_id: input.showId,
      user_id: input.userId,
      seats: requestedSeats,
      amount_paise: amountPaise,
      status: 'confirmed' as const,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
