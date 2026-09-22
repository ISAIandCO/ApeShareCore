// Event semantics, independent of SIEM field names and normalization packages.
// Numeric syscall IDs are intentionally absent: they depend on the Linux ABI.
export const AUDIT_OPERATION_RECIPES = Object.freeze([
  { id: 'security-files', name: 'Windows Security: использование файлов', category: 'files', platform: 'windows', eventValues: '4663', operationValues: 'File', selectorRequired: true,
    requirements: 'Audit File System + SACL. EventData.ProcessId — инициатор; ObjectType=File, ObjectName — путь. AccessMask — использованные права. Не System.Execution.ProcessID.' },
  { id: 'security-registry-access', name: 'Windows Security: доступ к реестру', category: 'registry', platform: 'windows', eventValues: '4663', operationValues: 'Key', selectorRequired: true,
    requirements: 'Audit Registry + SACL. EventData.ProcessId — инициатор; ObjectType=Key, ObjectName — ключ; AccessMask — использованные права.' },
  { id: 'security-registry-value', name: 'Windows Security: изменение значения реестра', category: 'registry', platform: 'windows', eventValues: '4657',
    requirements: 'Audit Registry + SACL Set Value. ProcessId — инициатор; ObjectName — ключ, ObjectValueName — имя значения (поле части объекта). Не смешивать разные значения одного ключа.' },
  { id: 'security-access', name: 'Windows Security: доступ к процессу', category: 'access', platform: 'windows', eventValues: '4663', operationValues: 'Process', selectorRequired: true,
    requirements: 'Audit Kernel Object + SACL. ObjectType=Process; ProcessId — инициатор, ObjectName — цель, AccessMask — права. События без идентифицируемой цели не создают связь. Не подставлять HandleId как PID цели.' },
  { id: 'security-network', name: 'Windows Security: разрешённые / заблокированные соединения', category: 'network', platform: 'windows', eventValues: '5156, 5157',
    requirements: 'Audit Filtering Platform Connection (Success/Failure). EventData.ProcessID — процесс приложения; DestAddress/DestPort — назначение пакета, Protocol — протокол. При входящем трафике назначение локальное; 5157 означает блокировку, не успешное соединение.' },
  { id: 'auditd-files', name: 'Linux auditd: операции с путями', category: 'files', platform: 'unix', eventValues: 'SYSCALL', operationValues: 'open, openat, openat2, creat, unlink, unlinkat, rename, renameat, renameat2, link, linkat, symlink, symlinkat, mkdir, mkdirat, rmdir, truncate, chmod, fchmodat, chown, lchown, fchownat', selectorRequired: true,
    requirements: 'Правила audit для нужных syscall. Нужен объединённый SYSCALL+PATH/CWD одного audit serial и хоста: pid (не ppid), декодированное имя syscall, путь и success/exit. Числа syscall без архитектуры и отдельные PATH не поддерживаются. FD не является путём.' },
  { id: 'auditd-network', name: 'Linux auditd: connect', category: 'network', platform: 'unix', eventValues: 'SYSCALL', operationValues: 'connect', selectorRequired: true,
    requirements: 'Аудит connect. Объединённые SYSCALL+SOCKADDR одного audit serial/хоста: pid инициатора, декодированные адрес и порт назначения, success/exit. Не отдельный SOCKADDR и не socketcall без декодирования подоперации. Попытка connect не доказывает успех.' },
  { id: 'auditd-access', name: 'Linux auditd: доступ к памяти процессов', category: 'access', platform: 'unix', eventValues: 'SYSCALL', operationValues: 'ptrace, process_vm_readv, process_vm_writev', selectorRequired: true,
    requirements: 'Аудит этих syscall; pid — инициатор. Целевой PID должен быть декодирован нормализатором: ptrace a1, process_vm_* a0 с учётом ABI. Не ppid/uid. ptrace TRACEME и записи без цели не подходят. Сохраняйте success/exit.' },
  { id: 'auditd-modules', name: 'Linux auditd: загрузка модулей ядра из файла', category: 'modules', platform: 'unix', eventValues: 'SYSCALL', operationValues: 'finit_module', selectorRequired: true,
    requirements: 'Аудит finit_module; pid — инициатор, цель — достоверно разрешённый путь файла модуля (не FD a0), success/exit. Если нормализатор не разрешает FD, профиль неприменим. Это модули ядра, не произвольные .so; open/mmap не доказывают загрузку библиотеки.' },
]);
