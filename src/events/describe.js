export function describeEvent({ msgid, action, host, account, process, commandLine, sourceIp, destinationIp, file, correlationRule, normalizationRule, sourceTitle, originalDescription, eventName } = {}) {
  const normalizedAction = action?.toLocaleLowerCase();
  const processStarted = process && (["1", "4688", "execve"].includes(String(msgid).toLocaleLowerCase())
    || ["start", "started", "create", "created", "execute", "executed", "run"].includes(normalizedAction));
  const processStopped = process && (["2", "4689"].includes(String(msgid).toLocaleLowerCase())
    || ["stop", "stopped", "terminate", "terminated", "exit", "exited"].includes(normalizedAction));
  let title;
  if (processStarted) title = `Запущен процесс «${process}»`;
  else if (processStopped) title = `Завершён процесс «${process}»`;
  else if (["4624", "user_login"].includes(String(msgid).toLowerCase())) title = account ? `Пользователь «${account}» вошёл в систему` : "Выполнен вход в систему";
  else if (["4625", "user_auth"].includes(String(msgid).toLowerCase())) title = account ? `Неудачный вход пользователя «${account}»` : "Неудачная попытка входа";
  else if (["4634", "4647"].includes(String(msgid))) title = account ? `Пользователь «${account}» вышел из системы` : "Выполнен выход из системы";
  else if (sourceIp && destinationIp) title = `Сетевое соединение ${sourceIp} → ${destinationIp}`;
  else if (file && ["create", "created", "write", "written"].includes(normalizedAction)) title = `Создан файл «${file}»`;
  else if (file && ["delete", "deleted", "remove", "removed"].includes(normalizedAction)) title = `Удалён файл «${file}»`;
  else if (file && ["modify", "modified", "change", "changed", "rename", "renamed"].includes(normalizedAction)) title = `Изменён файл «${file}»`;
  else if (correlationRule) title = `Сработало правило корреляции «${correlationRule}»`;
  else if (normalizationRule) title = `Событие нормализовано правилом «${normalizationRule}»`;
  else if (msgid) title = `Событие ${msgid}`;
  else title = eventName ?? "Событие SIEM";
  const details = [
    host ? `Хост: ${host}` : null,
    account && !title.includes(account) ? `Учётная запись: ${account}` : null,
    process && !title.includes(process) ? `Процесс: ${process}` : null,
    commandLine && commandLine !== process ? `Командная строка: ${commandLine}` : null,
    sourceIp && !title.includes(sourceIp) ? `Источник: ${sourceIp}` : null,
    destinationIp && !title.includes(destinationIp) ? `Назначение: ${destinationIp}` : null,
    correlationRule && !title.includes(correlationRule) ? `Правило корреляции: ${correlationRule}` : null,
    normalizationRule && !title.includes(normalizationRule) ? `Правило нормализации: ${normalizationRule}` : null,
    sourceTitle && sourceTitle !== normalizationRule ? `Источник события: ${sourceTitle}` : null,
    originalDescription,
    action && !title.toLocaleLowerCase().includes(normalizedAction) ? `Действие: ${action}` : null,
    msgid && !title.includes(String(msgid)) ? `ID события: ${msgid}` : null,
  ].filter(Boolean);
  return { title: String(title), description: details.join(" · ") || "Описание отсутствует в нормализованных полях события" };
}
