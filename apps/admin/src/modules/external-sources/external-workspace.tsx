import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Outlet, useBeforeUnload, useBlocker, useOutletContext } from 'react-router-dom';
import { Modal } from 'antd';
import type { StaffMe } from '@hd/contracts/admin';

const GuardContext = createContext<(key: symbol, guarded: boolean) => void>(() => {});

export function useExternalGuard(guarded: boolean) {
  const update = useContext(GuardContext);
  const key = useRef(Symbol());
  useLayoutEffect(() => {
    update(key.current, guarded);
    return () => update(key.current, false);
  }, [guarded, update]);
}

export function ExternalWorkspace() {
  const staff = useOutletContext<StaffMe>();
  const guards = useRef(new Set<symbol>());
  const [guarded, setGuarded] = useState(false);
  const update = useCallback((key: symbol, active: boolean) => {
    if (active) guards.current.add(key);
    else guards.current.delete(key);
    setGuarded(guards.current.size > 0);
  }, []);
  const blocker = useBlocker(() => guards.current.size > 0);
  useBeforeUnload(event => {
    if (!guards.current.size) return;
    event.preventDefault();
    event.returnValue = '';
  });
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('admin:dirty', { detail: guarded }));
    return () => { window.dispatchEvent(new CustomEvent('admin:dirty', { detail: false })); };
  }, [guarded]);
  return <GuardContext.Provider value={update}>
    <Outlet context={staff} />
    <Modal open={blocker.state === 'blocked'} title="请先处理当前外部车源操作" okText="留在当前页"
      cancelButtonProps={{ style: { display: 'none' } }} onOk={() => blocker.reset?.()} onCancel={() => blocker.reset?.()}>
      当前有未保存的修订，或有操作结果需要核对。请处理后再离开。
    </Modal>
  </GuardContext.Provider>;
}
