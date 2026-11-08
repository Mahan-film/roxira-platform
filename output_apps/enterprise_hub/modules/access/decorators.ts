import { SetMetadata } from '@nestjs/common';
import { AccessAction, AccessModule, SensitiveField } from './catalogue';

export const ACCESS_MODULE_KEY = 'roxira:accessModule';
export const ACCESS_ACTION_KEY = 'roxira:accessAction';
export const ACCESS_FIELD_KEY = 'roxira:accessField';
export const AUTH_ONLY_KEY = 'roxira:authOnly';
export const ANY_MEMBER_KEY = 'roxira:anyMember';
export const ACCESS_ALSO_KEY = 'roxira:accessAlsoModules';

/**
 * Class decorator: every handler of the controller belongs to this module.
 * The action is derived from the HTTP verb unless `@RequireAction` overrides it.
 */
export const ModuleAccess = (module: AccessModule): ClassDecorator & MethodDecorator =>
  SetMetadata(ACCESS_MODULE_KEY, module);

/** Handler decorator: explicit action (approve, post, export, admin, ...). */
export const RequireAction = (action: AccessAction): MethodDecorator =>
  SetMetadata(ACCESS_ACTION_KEY, action);

/** Handler/class decorator: requires visibility of a sensitive field (`cost`, `margin`, `salary`). */
export const RequireField = (field: SensitiveField): ClassDecorator & MethodDecorator =>
  SetMetadata(ACCESS_FIELD_KEY, field);

/**
 * Signed-in user, no organisation or permission needed (profile, org switching,
 * own sessions and 2FA, creating or joining an organisation).
 */
export const AuthOnly = (): ClassDecorator & MethodDecorator => SetMetadata(AUTH_ONLY_KEY, true);

/** GET/HEAD read; everything else is a write. */
export function actionForMethod(method: string): AccessAction {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS' ? AccessAction.READ : AccessAction.CREATE;
}

/** Any verified, active member of the active organisation; no module permission needed (e.g. "my organisation"). */
export const AnyMember = (): ClassDecorator & MethodDecorator => SetMetadata(ANY_MEMBER_KEY, true);

/**
 * Adds alternative modules for the same action on this handler only. Never use at class level.
 * It never widens a write unless the caller wrote it on a write handler.
 */
export const AlsoAllowModule = (...modules: AccessModule[]): MethodDecorator => SetMetadata(ACCESS_ALSO_KEY, modules);
