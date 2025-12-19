# prototype

My prototype for my Master's Thesis

## Get Started

Please follow the below steps in chronological order in order to setup your local working version of Masutā 達人.

### Requirements

You will need to have Docker and docker-compose installed in order to run the application.

### Background Information

The docker-compose file starts 2 local neo4j graph databases. One of these will be prefilled with SpeedParcel data and one will be empty and can be used as a playground for custom data.

On top of that, the frontend, backend, and MCP server will also be started.

The universal parser is also executed once and then stops.

### Adding SpeedParcel Example Data

[Download the latest backup from the BSCW folder.](https://bscw.frankfurt-university.de/EduRes/bscw/bscw.cgi/d21814333/neo4j-2025-12-10T21-44-58-fde218db.backup)

Place the downloaded file into the folder ./graph-data/

The next step will now be able to read this data and prefill one of the two graph databases with the SpeedParcel example data.

### First Time Setup / Restoring the local database

Execute the following commands individually. This restores any potential data saved in the container.

```
docker compose down
rm -rf $HOME/neo4j/data
rm -rf $HOME/neo4j_empty/data
docker compose --profile restore run --rm neo4j-restore
```

### Running the Application and All Components

```
docker compose up
```
