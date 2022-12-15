import { PrismaClient, PrismaPromise, Session } from '@prisma/client';
import { assert } from 'typescript-json';
import logger from '../util/logger';
import { Token } from '../service/TwitterService';
import { checkField } from '../util/Validation';

export interface SessionData {
  passport: {
    user: Express.User;
  };
}

export default class SessionManager {
  constructor(private prisma: PrismaClient) {}

  /**
   * Finads a session matching the given ID, or throws `NotFoundError` when no
   * session exists.
   * @param sessionId The session ID.
   * @returns A matching session.
   */
  public findSession(sessionId: string): PrismaPromise<Session> {
    return this.prisma.session.findUniqueOrThrow({
      where: { id: sessionId },
    });
  }

  /**
   * Deserializes a session's `data` column from the database's string
   * representation.
   * @param session The session to deserialize.
   * @returns The deserialized `SessionData`.
   */
  public getSessionData(session: Session): SessionData {
    const sessionData = assert<{ passport: { user: string } }>(
      JSON.parse(session.data)
    );

    // The user field is stringified twice when saved to the database
    const user = assert<Express.User>(JSON.parse(sessionData.passport.user));

    return { ...sessionData, passport: { user: user } };
  }

  /**
   * Updates the recorded OAuth token for a given session and saves it to the
   * database.
   * @param session The session to update.
   * @param token The new OAuth token.
   * @returns The updated Session.
   */
  public updateSessionToken(
    session: Session,
    token: Token | undefined
  ): PrismaPromise<Session> {
    logger.debug(`Updating OAuth token for session ${session.id}.`);

    if (
      !token ||
      !checkField(token, 'access_token') ||
      !checkField(token, 'refresh_token')
    ) {
      throw new Error(
        `Session ${session.id} no longer has a valid OAuth Token.`
      );
    }

    const sessionData = this.getSessionData(session);

    sessionData.passport.user.token = token;

    const sessionString = JSON.stringify({
      ...sessionData,
      passport: { user: JSON.stringify(sessionData.passport.user) },
    });

    return this.prisma.session.update({
      where: {
        id: session.id,
      },
      data: {
        data: sessionString,
      },
    });
  }
}
