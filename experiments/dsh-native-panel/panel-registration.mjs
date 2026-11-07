// Mount the descriptor before requesting its generated remote service: declaring
// the service as a root dependency would prevent this plugin from activating.
export function registerPanelBody(ctx, id, createBody) {
  ctx.inject(['remote.calendarSpike'], scope => {
    ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
      {name:'sidebar.right.pane.tab', key:id},
      () => createBody(scope.remote.calendarSpike)
    ));
  });
}
