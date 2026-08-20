export { destroySession } from './session';
export { assertCsrf } from '../security/csrf';
import { getSessionUser } from './session';

export const getSessionUserOrNull = () => getSessionUser();
