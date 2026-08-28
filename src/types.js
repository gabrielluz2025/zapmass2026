export var ConnectionStatus;
(function (ConnectionStatus) {
    ConnectionStatus["CONNECTED"] = "CONNECTED";
    ConnectionStatus["DISCONNECTED"] = "DISCONNECTED";
    ConnectionStatus["CONNECTING"] = "CONNECTING";
    ConnectionStatus["QR_READY"] = "QR_READY";
    ConnectionStatus["SUSPENDED"] = "SUSPENDED";
    ConnectionStatus["BUSY"] = "BUSY";
})(ConnectionStatus || (ConnectionStatus = {}));
export var CampaignStatus;
(function (CampaignStatus) {
    CampaignStatus["DRAFT"] = "DRAFT";
    /** Aguardando horário (próximo disparo em nextRunAt). */
    CampaignStatus["SCHEDULED"] = "SCHEDULED";
    CampaignStatus["RUNNING"] = "RUNNING";
    /** Fila inicial concluída; aguardando respostas para etapas seguintes (reply flow / multi-etapas). */
    CampaignStatus["WAITING_REPLY"] = "WAITING_REPLY";
    CampaignStatus["PAUSED"] = "PAUSED";
    CampaignStatus["COMPLETED"] = "COMPLETED";
    CampaignStatus["FAILED"] = "FAILED";
})(CampaignStatus || (CampaignStatus = {}));
