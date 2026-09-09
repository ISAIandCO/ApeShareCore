import { IOC_API_PROVIDERS } from "./providers.js";

/** Pure view model. No keys, storage, permissions or network access. */
export function iocActions(ioc, providers = IOC_API_PROVIDERS) {
  return Object.entries(providers).filter(([, provider]) => provider.types.includes(ioc?.type))
    .map(([id, provider]) => ({ id, name: provider.name, ioc: { type: ioc.type, value: ioc.value } }));
}

/**
 * Mount just the provider actions. The host owns layout, result rendering and access.
 * addButton(label, asyncHandler) optionally preserves the host's existing menu shell.
 * It returns the created button and calls asyncHandler(button) on an accepted click.
 */
export function mountIocActions(container, {
  ioc, lookup, onResult, onError, onSettled = () => {}, providers = IOC_API_PROVIDERS,
  labelFor = action => `${action.name} API`, pendingFor = action => `${action.name}: запрос…`,
  addButton, requireTrusted = false,
} = {}) {
  if (typeof lookup !== "function" || typeof onResult !== "function") throw new TypeError("IOC UI requires lookup and onResult callbacks");
  const cleanups = [];
  const buttons = [];
  let disposed = false;
  const add = addButton || ((label, run) => {
    const button = container.ownerDocument.createElement("button");
    button.type = "button"; button.textContent = label;
    const click = event => {
      event.stopPropagation();
      if (requireTrusted && !event.isTrusted) return;
      // Default DOM host reports errors via the supplied callback or an inline status.
      run(button).catch(error => {
        if (!disposed) {
          const status = container.ownerDocument.createElement("span");
          status.setAttribute("role", "status"); status.textContent = error.message;
          container.append(status); cleanups.push(() => status.remove());
        }
      });
    };
    button.addEventListener("click", click); container.append(button);
    cleanups.push(() => { button.removeEventListener("click", click); button.remove(); });
    return button;
  });
  for (const action of iocActions(ioc, providers)) {
    let busy = false;
    const label = labelFor(action);
    const button = add(label, async button => {
      if (busy || disposed) return;
      busy = true; button.disabled = true; button.textContent = pendingFor(action);
      try {
        const result = await lookup(action.id, { ...action.ioc });
        if (!disposed) await onResult(result, action);
      } catch (error) {
        if (!disposed) {
          if (onError) await onError(error, action);
          else throw error;
        }
      } finally {
        busy = false;
        if (!disposed) { button.disabled = false; button.textContent = label; onSettled(action); }
      }
    });
    buttons.push(button);
  }
  return { buttons, destroy() { disposed = true; cleanups.splice(0).forEach(cleanup => cleanup()); } };
}
