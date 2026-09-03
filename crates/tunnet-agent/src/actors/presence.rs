//! `PresenceActor`: owns presence service lifecycle per network.
//!
//! Frequently queried presence state stays in the efficient read model
//! (`PresenceTable`); the actor owns startup/shutdown only.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use kameo::actor::{Actor, ActorRef, WeakActorRef};
use kameo::error::{ActorStopReason, Infallible};
use kameo::message::{Context, Message};
use tunnet_core::direct::{PresenceConfig, PresenceTable, spawn_presence};
use uuid::Uuid;

#[derive(Clone)]
pub struct PresenceActorArgs {
    pub config: PresenceConfig,
    pub tables: Arc<Mutex<HashMap<Uuid, Arc<PresenceTable>>>>,
}

pub struct PresenceActor {
    args: PresenceActorArgs,
    task: Option<super::OwnedTask>,
}

impl Actor for PresenceActor {
    type Args = PresenceActorArgs;
    type Error = Infallible;

    async fn on_start(args: Self::Args, actor_ref: ActorRef<Self>) -> Result<Self, Self::Error> {
        let mut actor = Self { args, task: None };
        actor.start(actor_ref);
        Ok(actor)
    }

    async fn on_stop(
        &mut self,
        _actor_ref: WeakActorRef<Self>,
        _reason: ActorStopReason,
    ) -> Result<(), Self::Error> {
        if let Some(task) = self.task.take() {
            task.shutdown().await;
        }
        Ok(())
    }
}

impl PresenceActor {
    fn start(&mut self, actor_ref: ActorRef<Self>) {
        let cfg = self.args.config.clone();
        let tables = self.args.tables.clone();
        let network_id = cfg.network_id;
        let cancel = tokio_util::sync::CancellationToken::new();
        let wait_cancel = cancel.clone();
        let weak = actor_ref.downgrade();
        self.task = Some(super::OwnedTask::spawn("presence", cancel, async move {
            tokio::select! {
                _ = wait_cancel.cancelled() => {},
                res = spawn_presence(cfg) => {
                    match res {
                        Ok(handle) => {
                            if let Ok(mut t) = tables.lock() {
                                t.insert(network_id, handle.table);
                            }
                            // Presence handle runs until cancelled via tables drop;
                            // wait for shutdown here.
                            wait_cancel.cancelled().await;
                        }
                        Err(e) => {
                            // Abnormal: never mask a failed service as
                            // healthy. The supervisor restarts us (retrying
                            // presence); the restart limit guards storms.
                            tracing::warn!(%network_id, ?e, "presence failed to start");
                            if !wait_cancel.is_cancelled()
                                && let Some(actor) = weak.upgrade()
                            {
                                let _ = actor.tell(PresenceFailed).try_send();
                            }
                        }
                    }
                }
            }
        }));
    }
}

/// Presence service failed to start. Abnormal: restart (retry) via supervision.
struct PresenceFailed;

impl Message<PresenceFailed> for PresenceActor {
    type Reply = ();
    async fn handle(&mut self, _msg: PresenceFailed, _ctx: &mut Context<Self, Self::Reply>) {
        panic!("presence service unexpectedly terminated");
    }
}

pub struct GetPresenceStatus;
#[derive(Debug, Clone, kameo::Reply)]
#[allow(dead_code)]
pub struct PresenceStatus {
    pub network_id: Uuid,
    pub running: bool,
}

impl Message<GetPresenceStatus> for PresenceActor {
    type Reply = PresenceStatus;
    async fn handle(
        &mut self,
        _msg: GetPresenceStatus,
        _ctx: &mut Context<Self, Self::Reply>,
    ) -> Self::Reply {
        PresenceStatus {
            network_id: self.args.config.network_id,
            running: self.task.as_ref().is_none_or(|t| !t.is_cancelled()),
        }
    }
}

pub struct ShutdownPresence;
impl Message<ShutdownPresence> for PresenceActor {
    type Reply = ();
    async fn handle(&mut self, _msg: ShutdownPresence, ctx: &mut Context<Self, Self::Reply>) {
        // `on_stop` cancels and joins the owned task with a bounded timeout.
        ctx.stop();
    }
}
