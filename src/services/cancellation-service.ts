import { pool } from '../db/client.js';
import { DomainError } from '../errors/domain-error.js';

export interface CancellationResponse {
  reservation_id: string;
  show_id: string;
  user_id: string;
  seats: string[];
  status: 'cancelled';
}

export async function cancelReservation(reservationId: string, actorUserId: string): Promise<CancellationResponse> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The reservation row serializes concurrent cancellation attempts.
    const reservationResult = await client.query<{
      id: string;
      show_id: string;
      user_id: string;
      status: 'confirmed' | 'cancelled';
    }>(
      `SELECT id, show_id, user_id, status
       FROM reservations
       WHERE id = $1
       FOR UPDATE`,
      [reservationId],
    );
    const reservation = reservationResult.rows[0];
    if (!reservation) throw new DomainError('RESERVATION_NOT_FOUND', 404, 'Reservation not found');
    if (reservation.user_id !== actorUserId) {
      throw new DomainError('FORBIDDEN', 403, 'Only the reservation owner can cancel it');
    }

    const seatResult = await client.query<{ id: string; seat_number: string }>(
      `SELECT s.id, s.seat_number
       FROM reservation_seats rs
       JOIN seats s ON s.id = rs.seat_id
       WHERE rs.reservation_id = $1
       ORDER BY s.seat_number`,
      [reservationId],
    );
    const seatNumbers = seatResult.rows.map((seat) => seat.seat_number);

    // Cancellation itself is idempotent for the owner.
    if (reservation.status === 'cancelled') {
      await client.query('COMMIT');
      return {
        reservation_id: reservation.id,
        show_id: reservation.show_id,
        user_id: reservation.user_id,
        seats: seatNumbers,
        status: 'cancelled',
      };
    }

    // Only rows still owned by this reservation are released. Historical mappings remain untouched.
    const releasedResult = await client.query<{ id: string }>(
      `UPDATE seats
       SET status = 'available', reservation_id = NULL, updated_at = now()
       WHERE reservation_id = $1 AND status = 'confirmed'
       RETURNING id`,
      [reservation.id],
    );

    if (releasedResult.rowCount !== seatResult.rowCount) {
      throw new Error('Reservation seat ownership is inconsistent');
    }

    await client.query(
      `UPDATE reservations
       SET status = 'cancelled', cancelled_at = now()
       WHERE id = $1`,
      [reservation.id],
    );

    const inventoryResult = await client.query<{ active_seat_count: number }>(
      `UPDATE user_show_inventory
       SET active_seat_count = active_seat_count - $3, updated_at = now()
       WHERE show_id = $1 AND user_id = $2 AND active_seat_count >= $3
       RETURNING active_seat_count`,
      [reservation.show_id, reservation.user_id, releasedResult.rowCount],
    );
    if (inventoryResult.rowCount !== 1) throw new Error('User inventory is inconsistent during cancellation');

    await client.query('COMMIT');
    return {
      reservation_id: reservation.id,
      show_id: reservation.show_id,
      user_id: reservation.user_id,
      seats: seatNumbers,
      status: 'cancelled',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
